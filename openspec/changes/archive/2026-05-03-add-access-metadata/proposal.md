# Add per-note access metadata (GDPR-compliant)

## Why

Today, Kalepin records *changes* (the change-tracking feed) but not *accesses*. Users have a recurring intuition — "I want to know who looked at this note" — that we currently can't satisfy. Common cases:

- Owner shares a note via share-link or grant; wants to see whether the recipient actually opened it.
- Admin auditing: who accessed a sensitive document in a given week.
- Trust-but-verify on shared-with-me docs: "my collaborator says they've read the spec; the access log confirms it".

This is metadata, not content, so it's compatible with at-rest and E2E encryption alike (with a small caveat for E2E — see below). It's also a GDPR-relevant data type: storing "user X accessed path Y at time T" is personal data, and we need retention rules and a right-to-erasure path.

## What Changes

- **New table `note_access_log`**: `id INTEGER PK, path TEXT, viewer_email TEXT, action TEXT, ip_hash TEXT NULL, ts INTEGER`.
  - `action` ∈ `'view' | 'edit' | 'comment' | 'share-link-resolved'`.
  - `viewer_email` = `'anonymous'` for unauthenticated public-share viewers; otherwise the canonical email.
  - `ip_hash` = `HMAC-SHA256(ACCESS_LOG_IP_SALT, ip)[:8]` — per-deployment salt prevents IP correlation across instances.
- **Write hooks**: each of the following routes appends a row:
  - `GET /api/files/read` → `view`
  - `POST /api/files/create` and edit-via-OT → `edit` (deduped per session per path per minute)
  - `POST /api/comments` → `comment`
  - `GET /share/:code` (public resolve) → `share-link-resolved`
- **Read endpoint**: `GET /api/notes/:path/access-log?since=...&limit=...` — only the note's owner and admins can read. Returns paginated rows.
- **UI**: a small "Activity" section in the note metadata panel shows recent accesses ("alice@x viewed 3h ago · bob@x viewed yesterday"). Owner-only and admin-only.
- **Retention**: configurable via `ACCESS_LOG_RETENTION_DAYS` (default 90). A daily cron prunes rows older than retention.
- **Right-to-erasure (GDPR)**: `DELETE /api/users/me/access-log` — authenticated user deletes all rows where `viewer_email` = their canonical email. Admin variant: `DELETE /api/admin/users/{email}/access-log`.
- **Stage-2 caveat**: for paths where `isE2EEncrypted(path)` is true, the server only knows the user *fetched the ciphertext*, not that decryption succeeded. The `action` value SHALL be `'fetched'` (not `'view'`) for E2E paths, and the UI labels them accordingly.

## Capabilities

### New Capabilities

- `access-metadata`: Per-note access logging with GDPR-compliant retention and right-to-erasure, owner+admin readability, and a stage-2-aware action vocabulary.

### Modified Capabilities

- `file-management`: Read/edit routes append access-log rows.
- `comments`: Comment-create route appends access-log rows.
- `share-links`: Public resolve appends access-log rows with `viewer_email = 'anonymous'`.

## Impact

- **Backend**: new module `packages/backend/src/access-log/` (service + controller + cron). Hooks injected into existing controllers via DI.
- **Frontend**: a small `ActivityPanel.tsx` in the note-metadata view.
- **DB**: one new table + one new index `(path, ts DESC)` for read-the-latest queries.
- **Risk**: log table growth — mitigated by retention. Default 90d × 1000 active users × 50 reads/day = 4.5M rows. SQLite handles this fine; index on `(path, ts DESC)` keeps lookups O(log n).
- **GDPR**: retention default 90d; user-erasure endpoint; admin-erasure endpoint; documented in the privacy section of README.
