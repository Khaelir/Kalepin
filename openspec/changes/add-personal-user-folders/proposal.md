## Why

Kalepin today is a single shared vault: every authenticated user can read, write, list, and search every note. There is no per-user namespace at any layer — `User` has `email` + `id`, but the `FilesService`, the FTS5 index, the vector cache, the WebSocket fanout, and every MCP tool operate on the whole vault without a notion of ownership. Many real workflows need a private space (drafts, journals, sensitive client material) that is owner-only by construction, while still working transparently with backups, admin export, and the usual editing/search/MCP affordances. This change introduces such a space, with a hard guarantee — verified by an exhaustive multi-user e2e test — that another authenticated user (or any non-owner code path) cannot observe its existence, paths, content, attachments, comments, change history, or backlinks via *any* HTTP, WebSocket, MCP, or notification surface.

## What Changes

- **Storage layout (Layout B)**: Introduce a second on-disk root `PERSONAL_PATH` (default `./data/personal`) peer to `VAULT_PATH`. Personal notes live at `personal/{email}/...` physically, addressable as `_users/{email}/...` virtually throughout the codebase. The shared vault `vault/` no longer contains `_users/`. A new `RoutingStorageAdapter` wraps two `LocalFSAdapter` instances and dispatches reads/writes by virtual-path prefix. Forbid creating any top-level vault entry literally named `_users`.
- **Folder naming**: Personal folder name = lowercased email (e.g. `_users/alice@example.com/`). DB-recovery-safe because the folder name is the identifier-of-record (email), not an autoincrement id. Auto-created on first authenticated request after login. Non-renamable, non-deletable for its root segment; children behave normally.
- **Visibility predicate (the single source of truth)**: New helper `isVisibleTo(virtualPath, userEmail)` — true if the path is not under `_users/` OR is under `_users/{userEmail}/`. Every read path that emits paths or content runs through this predicate. Every write path that accepts a path argument runs through `assertWritableBy(path, userEmail)` (a stricter form: only the owner, never a peer).
- **Existence is non-observable**: Foreign personal paths return `404 Not Found`, never `403`. Tree listings, search results, link results, change feeds, comment search, WebSocket broadcasts, and MCP responses MUST NOT contain a path or any string derived from a path that the requester cannot read.
- **File API (`file-management` capability)**: `FilesController.{tree, read, create, delete, move, directory, history, version, restore, headings, downloadZip}` and `VaultController.createItem` are gated by the predicate. `tree` filters foreign `_users/{X}/` subtrees pre-response. `move` rejects either-end crossings of personal boundaries and rejects rename/delete of any `_users/{X}` root segment.
- **Download zip (`file-management`)**: Layout B makes `GET /api/files/download-zip` safe-by-construction — it pipes only the shared `vault/` root, plus the requester's own `personal/{email}/` subtree if any. Foreign personal data is structurally unreachable, not merely filtered.
- **Admin export (`admin-backup-download`)**: A new admin-only endpoint `GET /api/admin/export-zip` returns the union of both roots (shared + every personal folder). The S3 backup path (`s3-backup` capability) already tars both roots once `archiveService.createArchive()` is updated; no new wiring beyond the archive change.
- **Search (`full-text-search`, `semantic-search`)**: `SearchService.search(query, source, userEmail)` gains a required `userEmail` argument. The FTS5 query gets `AND (path NOT LIKE '\_users/%' ESCAPE '\' OR path LIKE '\_users/' || :email || '/%' ESCAPE '\')`. The in-memory vector cosine loop skips chunks where `!isVisibleTo(path, userEmail)`. Comments FTS gets the same predicate.
- **Links / graph (`link-index`)**: `getBacklinks`, `getOutgoingLinks`, `getUnlinkedMentions`, and `getGraphData` all require `userEmail` and filter results so no foreign personal sources or targets are emitted. Wikilink autocomplete (`wikilink-autocomplete`) inherits this through the underlying tree/index call.
- **Updates feed (`change-tracking`)**: `getChangesSince(...)` and `getRecentlyEdited(...)` require `userEmail` and drop rows whose path is not visible. The HTTP `/api/updates` and `/api/updates/recently-edited` endpoints, plus the MCP `get_updates` tool, pass `req.user.email` through. Diffs leak content; predicate runs at row-emission time.
- **Comments (`comments`)**: All path-keyed comment routes gate by `assertReadableBy`. Comment FTS results filter via the predicate.
- **Mention notifications (`notification`)**: When a comment / doc-mention / thread-reply originates from a path under `_users/{X}/` and would notify a user other than `X`, the notification is suppressed and the originating editor surfaces a one-time inline warning. (Cross-mentioning out of a personal folder is an out-of-band content leak by design; this change closes it by default.)
- **Attachments (`attachments`)**: Replace the single shared `_attachments/` directory with per-namespace attachment dirs:
  - Shared notes → `vault/_attachments/...` (unchanged).
  - Personal notes → `personal/{email}/_attachments/...`.
  Upload routes the file by inferring namespace from `docPath`. `GET /api/files/attachment` requires the requesting user to either own the namespace or for the attachment to live in shared `_attachments/`. Attachment names alone no longer grant access; the resolved physical path is checked against the requester.
- **Share links (`share-links`)**: Minting a share link via `POST /api/share-links` MUST reject paths the minting user cannot read (today: any authed user can mint a share link for any path). Owners minting a share link from their personal folder receive a UI confirmation that the link makes the note publicly readable via URL. Public-resolve (`/share/:code`) is unchanged — the token remains the permission.
- **OT / WebSocket (`ot-collaboration`)**: `doc:open` rejects (and disconnects) any client that opens a docId the user cannot read. The `broadcastToAll` path used for `file:tree-update` events becomes `broadcastToVisible`: each connected client receives a `file:tree-update` only if the path is visible to that client's user. The shared file-watcher is scoped to `vault/`. Each user's `personal/{email}/` is watched by a per-user subscription that fans out only to that user's WS connections.
- **MCP (`mcp-tool-registration`)**: Every MCP tool that reads, lists, searches, or writes by path threads `user.email` into the underlying service call. The wrapping helper `wrapTool(toolName, user, …)` is augmented with `assertVisibilityFor(toolName, args, user)` so adding new tools cannot accidentally bypass the predicate.
- **Auth (`auth`)**: First successful login creates the personal folder via `RoutingStorageAdapter.ensurePersonalFolder(email)` if absent. JWT continues to embed `sub` + `email`; nothing else changes in token issuance.
- **Frontend tree**: The personal folder renders as a top-level pseudo-section labeled "Personal" with a lock icon, before the shared roots. Its root segment hides Rename / Delete / Move-to-trash actions. Drag-into and move-out of children works normally; move that would cross into a foreign `_users/X` is rejected by the backend (UI guards client-side too).
- **Soft delete on user removal**: When a User row is deleted, `personal/{email}/` is moved to `personal/.deleted/{email}-{timestamp}/`. The deleted area is admin-only; restore is a manual `mv` for v1.
- **Migration**: None. The change is additive: `personal/` is created lazily; existing notes in `vault/` keep behaving identically. Single-tenant deployments are the common state today, so no triage flow is needed.
- **Test safety net (the load-bearing piece)**: A multi-user e2e test creates a personal note as Alice containing two unique tokens (path token + content token + attachment token + comment token), then exercises every authenticated HTTP route, every MCP tool, every WS event type as Bob, performing a recursive scan over every response/event for any of the tokens. The change is considered complete only when this scan returns zero matches across the entire surface.

## Capabilities

### New Capabilities

- `personal-user-folders`: Per-user private namespace at `_users/{email}/` (virtual) / `personal/{email}/` (physical), enforced by a single visibility predicate across every read, write, search, link, comment, notification, attachment, share-link, OT, MCP, and WebSocket surface, with a structural layout-B guarantee for backup/zip flows and an exhaustive multi-user e2e safety net.

### Modified Capabilities

- `storage-adapters`: New `RoutingStorageAdapter` and a second adapter root for personal data; virtual-path prefix routing for `_users/{email}/...`.
- `file-management`: Tree filter, per-route authz via `isVisibleTo` / `assertWritableBy`, non-renamable / non-deletable root segment for `_users/{email}`, layout-B safe-by-construction `download-zip`.
- `auth`: Auto-create `_users/{email}/` on first authenticated request post-login.
- `full-text-search`: SQL predicate gating notes_fts and comments_fts results by viewer.
- `semantic-search`: Vector cosine loop skips chunks not visible to the viewer.
- `link-index`: Backlinks, outgoing, unlinked-mentions, and graph results filter by viewer; the unlinked-mentions FTS sub-query inherits the FTS predicate.
- `change-tracking`: `getChangesSince` and `getRecentlyEdited` filter by viewer; HTTP `/api/updates*` and MCP `get_updates` thread `user.email`.
- `comments`: Path-keyed routes gate by predicate; comments_fts predicate applied; comment-mentioning across a personal boundary is suppressed at notification time.
- `notification`: Mention/doc-mention/thread-reply emails are suppressed when the source path is in a personal folder and the recipient is not the owner.
- `attachments`: Per-namespace `_attachments/` directories under each root; upload routing inferred from `docPath`; serve route gates by resolved namespace, not by file name alone.
- `share-links`: Mint route validates the minting user can read the path; UI warns when minting from a personal folder.
- `ot-collaboration`: `doc:open` gate; `broadcastToAll` becomes `broadcastToVisible` for `file:tree-update`; per-user watcher for personal subtrees in addition to the shared watcher.
- `mcp-tool-registration`: Every tool threads `user.email` into reads/writes; a registration-time check enforces visibility wiring.
- `admin-backup-download`: New admin-only `GET /api/admin/export-zip` returning the union of shared + every personal folder; S3 backup archive includes both roots.

## Impact

- **Affected code (backend)**:
  - `packages/backend/src/storage/routing-fs.adapter.ts` (new) — `RoutingStorageAdapter`.
  - `packages/backend/src/storage/storage.module.ts` — register the new adapter; introduce `PERSONAL_PATH` env var.
  - `packages/backend/src/auth/visibility.ts` (new) — `isVisibleTo`, `assertReadableBy`, `assertWritableBy`, `personalRootFor`, `isUnderPersonalRoot`.
  - `packages/backend/src/auth/auth.service.ts` — call `ensurePersonalFolder(email)` on first authenticated request.
  - `packages/backend/src/files/files.service.ts` — accept `userEmail` everywhere; reject root-segment rename/delete; route `move` ends through predicate.
  - `packages/backend/src/files/files.controller.ts`, `vault.controller.ts` — pass `req.user.email`; `tree` filters; `download-zip` excludes foreign personal subtree by selection (layout B already structurally protects).
  - `packages/backend/src/search/search.service.ts` — `userEmail` arg; FTS predicate; vector predicate; comments FTS predicate.
  - `packages/backend/src/search/search.controller.ts` — pass `req.user.email`.
  - `packages/backend/src/links/link-index.service.ts` — `userEmail` arg on `getBacklinks`, `getOutgoingLinks`, `getUnlinkedMentions`, `getGraphData`.
  - `packages/backend/src/links/links.controller.ts` — pass `req.user.email`.
  - `packages/backend/src/changes/change-tracking.service.ts` — `userEmail` arg on `getChangesSince` and `getRecentlyEdited`.
  - `packages/backend/src/changes/updates.controller.ts` — pass `req.user.email`.
  - `packages/backend/src/comments/comments.service.ts` — path gates; comments_fts predicate.
  - `packages/backend/src/comments/comments.controller.ts` — pass `req.user.email`; gate per route.
  - `packages/backend/src/comments/notification.service.ts` — suppress cross-personal mentions; new `isCrossPersonalMention(notePath, recipientEmail)` helper.
  - `packages/backend/src/attachments/attachments.service.ts` — per-namespace dirs; upload routes by `docPath`; serve resolves with requester context.
  - `packages/backend/src/attachments/attachments.controller.ts` — pass `req.user.email`.
  - `packages/backend/src/share-links/share-links.controller.ts` — mint validates `assertReadableBy`.
  - `packages/backend/src/ot/ot.gateway.ts` — `doc:open` gate; `broadcastToVisible` replacing `broadcastToAll`; per-user file-watcher subscriptions.
  - `packages/backend/src/files/file-watcher.service.ts` — split into shared watcher (vault) + per-user watchers (personal).
  - `packages/backend/src/mcp/mcp.service.ts` — thread `user.email` into every leaf call; new `assertVisibilityFor` registration-time check.
  - `packages/backend/src/backup/backup.service.ts` and `packages/backend/src/archive/archive.service.ts` — archive both roots.
  - `packages/backend/src/archive/archive.controller.ts` — new admin export route.
- **Affected code (frontend)**:
  - `packages/frontend/src/components/FileTree.tsx` (or equivalent) — render the `Personal` pseudo-folder, hide rename/delete on its root, lock icon, drag-target rules.
  - `packages/frontend/src/i18n/*` — labels for "Personal", lock-icon tooltip, share-link warning copy.
  - `packages/frontend/src/api.ts` — add `getPersonalFolderPath()` (server-derived from JWT email) helper; admin export endpoint.
- **APIs**: One new admin route (`GET /api/admin/export-zip`). Existing routes preserve their shapes; behavior changes are *narrowing* (fewer rows returned to non-owners). No deprecations.
- **Persistence**: No DB schema changes. New `PERSONAL_PATH` env var with default `./data/personal`. No migration script.
- **Cross-editor compatibility**: `personal/` is a separate root on disk and is NOT exposed to Obsidian / external editors unless they explicitly point at it. Users continue to open the shared vault at `VAULT_PATH` and Obsidian sees no `_users/` directory there — the boundary is a layout fact.
- **Backups**: S3 backup tars the union of both roots. Restore is symmetric. Existing operators must be told the on-disk layout has a new top-level directory peer to `vault/`.
- **Performance**: SQL predicate cost is negligible; vector loop cost unchanged; per-user watcher cost = 1 inotify subscription per active user (bounded). MCP threading is purely structural; no extra calls.
- **Security boundary**: The boundary is API-layer, not encryption-at-rest. Anyone with disk access (admin, restored backup, host shell) sees `personal/` plainly. Documented in design.md.
