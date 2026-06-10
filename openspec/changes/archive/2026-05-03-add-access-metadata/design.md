# Design: per-note access metadata

## Schema

```sql
CREATE TABLE note_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  viewer_email TEXT NOT NULL,            -- canonical, or 'anonymous'
  action TEXT NOT NULL,                  -- 'view' | 'edit' | 'comment' | 'share-link-resolved' | 'fetched'
  ip_hash TEXT,                          -- 8B hex, nullable
  ts INTEGER NOT NULL                    -- unix ms
);
CREATE INDEX idx_access_log_path_ts ON note_access_log (path, ts DESC);
CREATE INDEX idx_access_log_viewer_ts ON note_access_log (viewer_email, ts DESC);
```

The viewer-keyed index supports the GDPR right-to-erasure query (`DELETE WHERE viewer_email = ?`).

## Dedup

Edit events fire often (every save, sometimes every keystroke via OT). To avoid log-spam:
- An edit is logged at most once per `(path, viewer_email)` per 60-second window.
- Implementation: in-memory LRU keyed by `${path}:${email}`; if the entry's `ts` is within 60s, skip the insert.
- View events: deduped per 5 minutes using the same mechanism (otherwise opening a doc and scrolling pages it five times shows five views).

## IP hashing

```
ACCESS_LOG_IP_SALT (env var, 32B random, generated on first boot)
ip_hash = HMAC-SHA256(ACCESS_LOG_IP_SALT, ip)[:8]
```

Per-deployment salt means IP correlation across instances is impossible. Per-user salt (correlation across the *same* deployment) is rejected — the point of the IP hash is "weird-login" detection (multiple distinct IP hashes for one user in a short window), which requires deployment-scoped consistency.

## Visibility rules

- **Owner of the path** can read access log for paths they own.
- **Admins** can read any access log.
- **Grantees** (after `add-shared-with-me-grants`): can read logs for paths granted to them only with explicit `'read-log'` permission. Default grants do NOT include log-read. (Decision deferred — placeholder spec entry.)

## Retention

- Default: 90 days (`ACCESS_LOG_RETENTION_DAYS=90`).
- Cron: daily at 03:00, deletes rows where `ts < now() - retention_days * 86400 * 1000`.
- Configurable to `0` for "no retention" (i.e., live forever) on private deployments — but the README warns about GDPR implications.

## Right-to-erasure

- `DELETE /api/users/me/access-log` — authenticated; deletes all rows where `viewer_email = req.user.email`. Returns count deleted.
- `DELETE /api/admin/users/{email}/access-log` — admin-only.
- Anonymous logs (`viewer_email = 'anonymous'`) are not personally identifiable per GDPR (with the IP hash being keyed and truncated). They still respect retention.

## Stage-2 awareness

The `action` value for a read on an E2E-encrypted path is `'fetched'`, not `'view'`. The frontend ActivityPanel labels these as "fetched (encrypted, decryption status unknown)". This is the honest semantic: the server only knows the ciphertext was downloaded.

## Dependencies on prior changes

- None. This change is independent of `add-at-rest-encryption-with-e2e-seams`. It can ship before, after, or alongside.
- It DOES consume the `isE2EEncrypted` predicate from the encryption capability for the `'fetched'` vs `'view'` distinction. If shipped before stage 1, the predicate stub still exists (returns false everywhere), so all reads log as `'view'`. Correct behavior either way.
