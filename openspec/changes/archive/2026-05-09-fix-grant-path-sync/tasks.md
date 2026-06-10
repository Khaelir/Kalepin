# Tasks — fix grant path-sync

## 1. Service methods

> **Note**: the proposed `updatePath`/`updatePathPrefix`/`deleteByPath` methods already exist as
> `GrantsService.cascadeRename(src, dest)` (handles both exact and prefix in one call) and
> `GrantsService.cascadeDelete(path)` (handles both exact and prefix in one call). The
> behavior matches the spec; we use the existing names rather than adding parallel-named
> wrappers.

- [x] 1.1 ~~Add `GrantsService.updatePath(oldPath, newPath)`~~ — covered by `cascadeRename` exact-match branch.
- [x] 1.2 ~~Add `GrantsService.updatePathPrefix(oldPrefix, newPrefix)`~~ — covered by `cascadeRename` prefix branch.
- [x] 1.3 ~~Add `GrantsService.deleteByPath(path)` / `deleteByPathPrefix`~~ — covered by `cascadeDelete` (does both).
- [x] 1.4 Unit tests: see `grants.service.test.ts` `cascadeRename` and `cascadeDelete` describe blocks.

## 2. Hook into write paths

- [x] 2.1 `FilesService.deleteFile` / `deleteDirectory` — calls `grants.cascadeDelete` (lines 184, 268).
- [x] 2.2 `FilesService.move` — calls `grants.cascadeRename` (line 309).
- [x] 2.3 `RenameTrackingService` — `cascadeRename` on rename, `cascadeDelete` on external unlink.
- [x] 2.4 `SecureFilesService.moveToSecure` already calls `cascadeDelete`; added defensive `cascadeDelete` in `moveFromSecure` for symmetry.

## 3. Resolve-on-list safety net

- [x] 3.1 `FilesService.listLiveGrantsForGrantee` — `Promise.all(grants.map(g => storage.exists(g.path)))`; drops rows where the file no longer exists. Used by both `buildSharedWithMeRoot` (file-tree) and `FilesController.sharedWithMe` (`/api/files/shared-with-me` endpoint).
- [x] 3.2 Async GC: dropped rows fire-and-forget `grants.cascadeDelete(path)` to purge the dangling row.
- [x] 3.3 Unit test in `files.service.grants.test.ts` — both the tree-filter and the GC pass.

## 4. End-to-end tests

Added to `packages/e2e/tests/sharing-permissions.spec.ts` as the API-only "Sharing — grant path-sync on rename and delete" describe block.

- [x] 4.1 Alice grants then renames the file; Bob's `_shared_with_me` shows the new path; old read 404s.
- [x] 4.2 Alice grants then deletes; Bob's tree no longer lists it; read returns 404.
- [x] 4.3 Folder rename — both descendant grants follow to the new prefix.
- [x] 4.4 Dangling grant (minted on a never-existed path) is filtered on first list and revoked by async GC.

## 5. Incidental fixes uncovered by 4.x

- [x] 5.1 `EncryptingStorageAdapter.move` — fixed an EISDIR crash on directory moves under at-rest encryption. Was a pre-existing production bug (broke folder rename in any encrypted personal vault). The adapter now walks the directory and re-encrypts each file at the destination so the AAD stays bound to the new path. All 15 existing `encrypting-fs.adapter.test.ts` cases still pass; the new behaviour is exercised end-to-end by task 4.3.
