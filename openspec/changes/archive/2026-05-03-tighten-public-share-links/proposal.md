# Tighten public share-links: explicit mint, expiry, revoke UI

## Why

The toolbar's "Share" button copies a URL to the clipboard that, when pasted to anyone, grants them unauthenticated read access to the note for life. Three concerns from the share-feature triage:

1. **The link is auto-minted on every file open**, so even private notes have a publicly-resolvable `/share/:code` row in the `short_links` table from the moment they are first viewed — whether or not the user ever clicks "Share".
2. **There is no UI to revoke or list public links**. `ShareLinksService.deleteByPath` exists but is only invoked by delete / rename / secure-move flows. The user cannot turn off a leaked URL short of deleting or moving the file.
3. **There is no expiry**. A link minted today is valid in five years. The per-recipient grants system already supports expiry (1d / 7d / 30d / never) but the share-link path doesn't.

The asymmetry is the bug: per-recipient grants have controls (permission, expiry, revoke), public links have none — yet public links are the looser modality and the one the toolbar surfaces by default.

## What Changes

- **Stop auto-minting on file open.** `openFile` no longer calls `api.createShareLink(path)`. The URL stays in the legacy `?file=…` (or equivalent) form until the user explicitly chooses to share. When they click "Copy share link" (or equivalent), *then* a code is minted (and the URL bar updates to `/d/<code>/...` so the freshly-copied URL works).
- **Add expiry to share-links.** `short_links` gets `expires_at INTEGER NULL` and `created_by_email TEXT NOT NULL`. A `null` value preserves the legacy "never expires" behaviour for codes minted before this change. New codes default to **30 days for personal-folder paths** and **never for shared-vault paths** (configurable per mint).
- **Add a revoke endpoint.** `DELETE /api/share-links/:code` (owner-or-admin) marks the row deleted. `GET /api/share-links/by-path?path=...` (owner-or-admin) returns the existing code, expiry, and last-resolved-at for a path.
- **Surface management in `ShareDialog`.** Above the per-recipient list, add a "Public link" section that shows: link state (none / active / expired), the URL with a copy button, expiry select (1d / 7d / 30d / never), last-resolved-at if access-metadata is shipped, and a Revoke button. This collapses the two sharing modalities into one dialog.
- **Demote the toolbar button.** The top-row Share affordance opens `ShareDialog` (not the public-link copy flow). `Cmd-shift-C` keeps a "Copy public link…" shortcut for power users that is functionally identical to the dialog's copy button (mints if needed, copies, returns).
- **Migration of existing rows**: leave `expires_at = null` for all pre-existing rows (they keep their legacy "never" behaviour). A one-time `UPDATE` is *not* applied — operators can opt in via a CLI script if they want retroactive tightening.

## Capabilities

### Modified Capabilities

- `share-links`: Codes are minted only on explicit user action (not on `openFile`), carry an optional expiry, and can be revoked via API. The public viewer rejects expired or revoked codes with 410.
- `document-grants`: `ShareDialog` (the file-share dialog rendered from this capability's UI) gains a public-link management section.

## Impact

- **Backend**:
  - `packages/backend/src/entities/short-link.entity.ts` — add `expires_at`, `created_by_email`, `revoked_at`.
  - `packages/backend/src/share-links/share-links.service.ts` — `mintExplicit({ path, ttlMs, createdByEmail })` returns code; `revoke(code)`; `findByPath(path)` returns metadata; `resolve` rejects expired/revoked codes.
  - `packages/backend/src/share-links/share-links.controller.ts` — new `DELETE /api/share-links/:code`, new `GET /api/share-links/by-path`, `POST /api/share-links` accepts optional `ttl_ms`.
  - SQLite migration `add_share_link_expiry`.
- **Frontend**:
  - `packages/frontend/src/App.tsx:701-740` — drop `api.createShareLink(path)` from `openFile`. The legacy URL stays until explicit mint.
  - `packages/frontend/src/App.tsx:1217-1238` — `handleShare` opens `ShareDialog` (single source of truth) instead of copying the URL.
  - `packages/frontend/src/components/ShareDialog.tsx` — add public-link panel: state, copy, expiry select, revoke. New api helpers: `findShareLinkByPath`, `mintShareLink({ path, ttlMs })`, `revokeShareLink(code)`.
  - URL routing: when a user navigates to `/d/<code>/...` and the code is revoked or expired, show a "This link is no longer active" page instead of resolving to the file.
- **DB**: one column-additive migration. No backfill; pre-existing rows behave as before.
- **Cross-cutting**:
  - `add-comments-on-public-shares` (in flight) is unaffected — comments still hang off the underlying path; revoke just makes the share-link viewer return 410 before the comment panel renders.
  - `add-access-metadata` (in flight) gains a natural surface (`last-resolved-at` on the public-link panel). When access-metadata is not shipped, the panel hides that row.
- **Risk**: the auto-mint removal changes user-visible URL behaviour. Today, copying a URL from the address bar at any time gives a working share-link; after this change, the address bar shows a private-only URL until the user explicitly shares. Mitigated by surfacing the public-link panel prominently and by a one-time toast on first manual copy ("Public link generated. Anyone with this URL can read this note for 30 days. Manage access in the share dialog.").
