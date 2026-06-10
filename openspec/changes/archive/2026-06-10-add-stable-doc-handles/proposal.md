# Stable, opaque internal doc handles + drop cosmetic path on share-links

## Why

In-app navigation today uses two URL forms that bleed into each other:

- `/doc/<full/path/to.md>` — for unshared docs, leaks the full vault path (including `_users/<email>/…` for personal notes).
- `/s/<code>/<cosmetic>` — once a doc has a public share-link, the *in-app* URL bar is rewritten to the share-link form (`App.tsx:702-703`, `App.tsx:1265-66`, `App.tsx:1878-79`).

Two problems result:

1. **Internal URLs rot.** A BH user copies their browser URL, pastes it into Slack/email to a colleague. The URL is `/s/<code>/<cosmetic>`. Later the share-link is revoked or re-minted — every paste is dead, even though the colleague has full vault access.
2. **Internal URLs leak structure.** When the URL is in `/doc/<path>` form, it exposes the full vault layout (including personal-folder emails). When it's in `/s/<code>/<cosmetic>` form, the cosmetic path leaks the same structure to anyone the link is forwarded to.

The recipient URL (`/s/<code>`) is a *disposable* handle the link's owner can revoke. The internal URL should be a *durable, opaque* handle tied to the file's existence, not to a share-link's lifecycle.

## What Changes

- **New durable per-file handle.** Each file in the vault gets a stable opaque ID (12–16 char base32 alphabet, crypto-random, collision-checked). Lazy-minted: the handle is created on first observation (file create, first read, or chokidar `add`). Persists across rename/move. Stored in a new `doc_handles` table with `id`, `path`, `created_at`, `tombstone_at`.
- **`/doc/<id>` is the in-app URL.** The browser address bar always shows `/doc/<id>` for authed users. `openFile` no longer emits `/s/<code>/<cosmetic>` after a share-link is minted, and no longer emits `/doc/<full/path>`. Cmd-L Cmd-C reliably copies a durable, opaque internal URL.
- **Backend resolves `/doc/<id>`.** `DocHandlesService.resolve(id)` returns `{ path, tombstoned }`. Reads via `/api/files/read` accept either `path` (legacy) or `handle`; the response always carries the handle so the frontend can normalize.
- **Tombstones.** When a file is deleted, the handle row is marked tombstoned (not removed). Resolving a tombstoned handle returns 410 with `{ tombstoned: true }` and the frontend renders a "this note no longer exists" card (distinct from the existing share-link 410 card).
- **Rename and move preserve handles.** File rename/move updates `path` on the existing row instead of minting a new ID. The same approach `short_links` already takes (`file-management:Rename a file that has a share link`).
- **Cosmetic path dropped from public share URLs entirely.** `/s/<code>` is the only recipient form the codebase emits. The legacy `/s/<code>/<cosmetic>` and `/d/<code>/<cosmetic>` parser arms are removed; `/d/<code>` (legacy, code-only) keeps resolving. The cosmetic-fallback recovery path at `App.tsx:919-922` (open the cosmetic path if the code is gone) is removed — code-dies-while-authed shows the same 410 card as anyone else.
- **Share-link mint no longer rewrites the address bar.** Both `replaceState` calls (`App.tsx:1265-66`, `App.tsx:1878-79`) are dropped. The clipboard still gets `/s/<code>` via `buildShareLinkUrl`; the address bar stays on `/doc/<id>`.
- **Authed user lands on `/s/<code>`.** Resolve code → fetch handle → `replaceState` to `/doc/<id>`. `?thread=` and `#heading` fragments are preserved.
- **External-edit handling.** `FileWatcherService` mints a handle on chokidar `add` events for files that don't already have one. `unlink` events tombstone. Renames are reconciled via the existing `rename-correlator` pairing.

## Capabilities

### Added Capabilities

- `doc-handles`: new backend capability — durable, opaque per-file IDs. Lazy-minted, stable across rename/move, tombstoned on delete. Resolved by `DocHandlesService`. The in-app URL form `/doc/<id>` is owned by this capability.

### Modified Capabilities

- `file-management`: file CRUD ensures a handle exists for each file; rename/move updates `path` on the existing handle row; delete tombstones; `/api/files/read` accepts `handle` in addition to `path` and always returns the handle in its response.
- `share-links`: drops cosmetic path entirely from the recipient URL grammar. `/s/<code>` is the only emitted form; `/s/<code>/<cosmetic>` and `/d/<code>/<cosmetic>` parser arms are removed. The cosmetic-path fallback when a code resolves 410 is removed. Mint and revoke no longer rewrite the in-app URL bar — `buildDocUrl` is removed; `buildShareLinkUrl` is unchanged.

## Impact

- **Backend**:
  - `packages/backend/src/doc-handles/doc-handles.module.ts` (new).
  - `packages/backend/src/doc-handles/doc-handles.service.ts` (new) — `findOrCreateForPath`, `resolve`, `updatePath`, `tombstone`, `forPath`.
  - `packages/backend/src/entities/doc-handle.entity.ts` (new) — TypeORM entity, `synchronize=true` picks it up.
  - `packages/backend/src/files/files.controller.ts` — `/read` accepts `handle`, response carries `handle`; `/api/files/by-handle/:id` for resolve-then-redirect.
  - `packages/backend/src/files/files.service.ts` — create/delete/rename/move call into `DocHandlesService`.
  - `packages/backend/src/files/file-watcher.service.ts` — chokidar `add` mints, `unlink` tombstones; rename pairs reconcile via `rename-correlator`.
  - `packages/backend/src/share-links/share-links.controller.ts` — `/resolve/:code` response gains `handleId` so the frontend can normalize without a second roundtrip.
- **Frontend**:
  - `packages/frontend/src/urls.ts` — add `DOC_HANDLE_PREFIX` parser arm; remove `buildDocUrl`; `parseDocUrl` distinguishes `/doc/<id>` (handle: `[A-Za-z0-9]{12,16}`, no slash) vs `/doc/<path>` (legacy fallback).
  - `packages/frontend/src/App.tsx` — `openFile` always `replaceState`s to `/doc/<id>` once read returns; both share-link mint `replaceState`s removed; cosmetic-fallback at L919-922 removed; new tombstone 410 card; on `/s/<code>` entry, normalize to `/doc/<id>` after resolve.
  - `packages/frontend/src/api.ts` — `readFileByHandle(id)`; `resolveShareLinkPublic` response gains `handleId`.
  - `packages/frontend/src/editor/Editor.tsx` — in-doc link handler recognises `/doc/<id>` for internal cross-doc links.
- **Risk**:
  - **External edit during rename window.** If a user renames a file in Obsidian while the backend is offline, the chokidar `unlink` + `add` pair on next boot is not auto-paired without the rename-correlator window catching it. Worst case: tombstone + new ID. The old URL 410s; the file is reachable via the file tree. Acceptable given the rarity.
  - **Tombstone growth.** Tombstone rows are never garbage-collected. At BH scale this is negligible; at much larger scale, a periodic prune-after-N-months sweep is a reasonable follow-up.

- **Not a risk (verified)**:
  - **Backup restore.** The backup archive includes `kalepin.sqlite` (`s3-backup` capability), and `POST /api/admin/backup/restore` atomically replaces both vault and DB (`admin-backup-upload-restore` capability). `doc_handles` lives in that DB, so backup→restore preserves all handle IDs and existing internal URLs continue to work.
