# Tasks — quiet the create-new-file flow

## 1. Watcher .tmp filter

- [x] 1.1 Add `isAtomicWriteTmpPath(path)` helper next to `LocalFSAdapter.writeBytesAtomic`. Pattern: `/(?:^|\/)[^\/]+\.tmp\.[0-9a-f]+$/`.
- [x] 1.2 In `OTGateway.fileWatcher.onFileChange` and `onPersonalChange`, early-return when `isAtomicWriteTmpPath(event.path)` for both the `file:changed` and `file:tree-update` branches.
- [x] 1.3 Unit test against the OT gateway: feeding a synthetic `change` event with a `.tmp.abc123` path does not produce a `file:changed` broadcast.
- [x] 1.4 E2E test: trigger a `writeBytesAtomic` in a watched folder; assert no `.tmp` paths reach connected clients.

## 2. Self-saved paths cover REST writes

- [x] 2.1 In `packages/frontend/src/api.ts`, wrap `createFile`, `moveFile`, `restoreVersion` (and any other write that produces a watcher echo) so they call `selfSavedPaths.add(targetPath)` before the fetch and `selfSavedPaths.delete(targetPath)` after a 5s TTL.
- [x] 2.2 Audit other write helpers in `api.ts` for completeness (rename via OT is already covered; pure REST renames may not be).
  - `createFile`, `moveFile`, `restoreVersion`, `createVaultItem` (notes), `createSecureVaultItem` (notes) — covered.
  - `deleteFile`, `deleteDirectory`, `createDirectory` — emit only `file:tree-update`, no `file:changed` toast surface.
  - Comments / pins / grants / OAuth / share-links — DB- or sidecar-only.
  - `uploadImage` — writes to `_attachments/`; non-`.md`, no `file:changed` broadcast.
  - `convertMention` — niche; leaves as a known gap (would need a path-aware wrapper if a regression appears).
- [x] 2.3 Test: a unit test on the api wrapper asserts that `selfSavedPaths` contains the target before the fetch resolves.

## 3. Active-doc toast suppression

- [x] 3.1 In `App.tsx`, the `ws.on('file:changed', …)` handler suppresses the toast when `msg.path === activeFileRef.current` and the OT session has received a revision update in the last 2s. Keep the existing content refresh behaviour for non-OT cases.
- [x] 3.2 Track `lastOTRevisionAt` ref or equivalent.
- [x] 3.3 Test: external editor writes the same path → toast fires (no recent OT). OT save → no toast.

## 4. Defer the share-with-X nudge

- [x] 4.1 Refactor `maybePromptShareNewNote(parentPath, newPath)` into:
  - `recordPendingShareNudge(parentPath, newPath)` (called from create) — records intent in a `nudgePending` map keyed by path with the resolved `(grantee, permission)` already computed.
  - `triggerPendingShareNudge(path)` — called from the OT first-non-empty-save callback or the rename-away-from-Untitled callback. Pops the entry and renders the toast.
- [x] 4.2 Hook OT session events: when the first save lands and the document is non-empty, invoke `triggerPendingShareNudge(path)`.
- [x] 4.3 Hook the rename flow: when the file is renamed away from `Untitled note.md`, invoke `triggerPendingShareNudge(newPath)` (before `triggerPendingShareNudge(oldPath)` is fired by save) — the rename takes precedence.
- [x] 4.4 Test: creating a private file in a folder with sibling grants triggers ZERO toasts. Typing one character and saving triggers the nudge once.

## 5. End-to-end

- [x] 5.1 Playwright test in `packages/e2e/tests/sharing-permissions.spec.ts`: as user-A in personal folder with sibling shared to user-B:
  - create a new file → assert no toasts about `File changed externally`
  - assert no toast contains the substring `.tmp.`
  - type "hello" and save → assert exactly one toast: "Untitled note.md is private. Share with user-B too?"
