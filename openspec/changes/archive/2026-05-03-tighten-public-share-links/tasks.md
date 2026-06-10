# Tasks — tighten public share-links

## 1. Schema + service

- [x] 1.1 SQLite migration `add_share_link_expiry`: add `expires_at`, `created_by_email`, `revoked_at` columns; add `idx_short_links_path` index.
- [x] 1.2 `ShareLinksService.mintExplicit({ path, ttlMs, createdByEmail })` — replaces `getOrCreate` for new flows. Idempotent: if an active (non-revoked, non-expired) row exists, returns the existing code. If the existing row is expired/revoked, mints a new code and leaves the old row.
- [x] 1.3 `ShareLinksService.revoke(code)` — `revoked_at = now`; subsequent resolves return 410.
- [x] 1.4 `ShareLinksService.findByPath(path)` — returns `{ code, expires_at, revoked_at, created_at, last_resolved_at? } | null`. `last_resolved_at` is sourced from the access-log if shipped, else null.
- [x] 1.5 `ShareLinksService.resolve` — returns 410 (or null distinguishing path) for expired/revoked codes.
- [x] 1.6 Unit tests for each branch.

## 2. Controller endpoints

- [x] 2.1 `POST /api/share-links` accepts optional `ttl_ms`. Defaults: `SHARE_LINK_DEFAULT_TTL_MS_PERSONAL=30 days`, `SHARE_LINK_DEFAULT_TTL_MS_SHARED=null`.
- [x] 2.2 `DELETE /api/share-links/:code` — owner of the underlying path or admin.
- [x] 2.3 `GET /api/share-links/by-path?path=...` — same authz; returns the metadata blob.
- [x] 2.4 `GET /api/share-links/resolve/:code` and `/share/:code` — return 410 with a page for revoked/expired.

## 3. Frontend — stage 1 (dialog UI, no behaviour change)

- [x] 3.1 `api.findShareLinkByPath`, `api.mintShareLink`, `api.revokeShareLink` helpers.
- [x] 3.2 `ShareDialog` adds a "Public link" section above the per-recipient list. States: none / active (URL + copy + expiry select + revoke) / expired (URL + revoke + re-mint button) / revoked (re-mint button).
- [x] 3.3 Toolbar Share button (`handleShare`) opens `ShareDialog` instead of `copyShareUrlToClipboard`.
- [x] 3.4 Keep a `Cmd-shift-C` shortcut that mints (if needed) and copies — equivalent to the dialog's copy button.
- [x] 3.5 Visual diff: `<copyShareUrlToClipboard>` becomes the action invoked from the public-link panel.

## 4. Frontend — stage 2 (flip auto-mint off)

- [x] 4.1 Remove `api.createShareLink(path)` from `openFile`. URL stays in the legacy `?file=…` form until explicit mint.
- [x] 4.2 When a code is minted via the dialog, the URL bar updates to `/d/<code>/...` so a fresh `Cmd-L Cmd-C` produces the public URL.
- [x] 4.3 Resolution path: hitting a 410 displays a friendly "This link is no longer active. The owner may have revoked it or it may have expired." page.

## 5. Optional: legacy expiry CLI

- [x] 5.1 `packages/backend/src/cli/expire-legacy-share-links.ts`: marks rows where `created_by_email IS NULL` and `created_at < :before` as expired. Off by default; for operators who want a clean break.

## 6. Tests

- [x] 6.1 Auto-mint stage 2: opening a file does not insert a `short_links` row.
- [x] 6.2 Mint with `ttl_ms = 30 days`: row resolves now, returns 410 after time-skip.
- [x] 6.3 Revoke: row's `revoked_at` is set; subsequent resolve returns 410.
- [x] 6.4 `ShareDialog` renders the existing-link state correctly for each (none / active / expired / revoked).
- [x] 6.5 Re-mint after expiry: a new code is generated; old code stays 410.
- [x] 6.6 Authorization: non-owner non-admin cannot revoke or call by-path.
