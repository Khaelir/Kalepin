# Fix grant path-sync on rename and delete

## Why

Today, when a grantor renames or deletes a file that they have granted to another user, the row in the `grants` table is left untouched. The grantee continues to see the old path in their `_shared_with_me/` virtual root, producing phantom entries that 404 on click. This is the root cause of the "files that were renamed or deleted still show up" report from the share-feature triage.

The `share_links` table already stays in sync with renames/deletes (`shareLinks.updatePath`, `shareLinks.updatePathPrefix`, `shareLinks.deleteByPath` are wired into `files.service.deleteFile`, `files.service.move`, and `rename-tracking.service.ts`). The same wiring was never added for `grants`.

## What Changes

- **Hook grants into rename**: `RenameTrackingService` and `FilesService.move` SHALL call `grantsService.updatePath(oldPath, newPath)` and `grantsService.updatePathPrefix(oldPrefix, newPrefix)` alongside the existing share-link calls. Folder-rename rewrites all child grants.
- **Hook grants into delete**: `FilesService.deleteFile` SHALL call `grantsService.deleteByPath(path)` to revoke any grants on a destroyed file. Folder-delete revokes all descendant grants. (A revoked grant is `revoked_at = now`, not a hard DELETE — the existing semantics are preserved for audit.)
- **Resolve-on-list safety net**: `FilesService.buildSharedWithMeRoot` SHALL filter out grants whose `path` no longer exists on disk before emitting the tree. Dangling rows are also asynchronously revoked (best-effort GC) so they stop coming back.
- **Move into a foreign personal folder is rejected** (already enforced by `assertWritableBy`); no new behaviour needed there. A move that crosses a granted file *out of* a personal folder into a shared location updates the grant path normally — the grantee now sees the file at its new shared location.

## Capabilities

### Modified Capabilities

- `document-grants`: Grants follow rename, are revoked on delete, and are filtered against on-disk existence at list time.
- `file-management`: `move` and `deleteFile` now call into the grants service (in addition to share-links).

## Impact

- **Backend**: 
  - `packages/backend/src/grants/grants.service.ts` — add `updatePath(oldPath, newPath)`, `updatePathPrefix(oldPrefix, newPrefix)`, `deleteByPath(path)` methods (mirror of share-links).
  - `packages/backend/src/files/files.service.ts:191-201` (delete) and `:300-305` (move) — call grants methods alongside share-links.
  - `packages/backend/src/files/rename-tracking.service.ts:39,73-74` — same.
  - `packages/backend/src/files/files.service.ts:434-467` (`buildSharedWithMeRoot`) — `Promise.all(items.map(g => storage.exists(g.path)))` filter.
- **Frontend**: none. The tree refreshes via `file:tree-update` and the dangling rows simply disappear once the backend is fixed.
- **DB**: no schema change. No migration. The fix takes effect for all subsequent renames/deletes; existing dangling rows are cleaned up by the resolve-on-list pass on first read.
- **Risk**: low. The change narrows what the grantee sees (correctness improvement) and matches the existing share-links wiring exactly. The only behavioural decision is "follow rename" vs "revoke on rename" — proposal picks **follow rename**, matching share-links and matching user expectations from comparable products (Google Docs, Dropbox).
