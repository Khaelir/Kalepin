# Tasks: add note trash

## 1. Paths, entity, visibility

- [x] 1.1 `auth/visibility.ts`: `TRASH_DIR`, `isTrashPath`; `isVisibleTo` returns false for trash paths.
- [x] 1.2 `GrantAwareVisibility.visibilityFor` denies trash paths before the grant lookup.
- [x] 1.3 `trash/trash-paths.ts`: `trashRootFor`, `zoneOf`, `ownerOf`, `restoredName` (" (restored)", " (restored 2)", …), `isSelfOrUnder`.
- [x] 1.4 Entity `entities/trash-item.entity.ts`; register in `entities/index.ts` and the `app.module.ts` entity list.

## 2. Dormant bookkeeping

- [x] 2.1 `ShareLinksService.resolve` answers `not_found` for trash paths; add `deleteByPathPrefix`.
- [x] 2.2 `GrantsService.listForGrantee` / `listForGrantor` filter trash paths.
- [x] 2.3 `StarsService.listByUser` filters trash paths.
- [x] 2.4 `DocHandlesService`: `findOrCreateForPath` never mints or reactivates a trash path; `tombstoneByPathPrefix`, `untombstoneByPathPrefix`.

## 3. FilesService and watcher

- [x] 3.1 `FileWatcherService.markSelfRemoved` / `isSelfRemoved` (TTL, prefix match).
- [x] 3.2 `FilesService`: `TrashHandler` + `setTrashHandler`; `deleteFile` / `deleteDirectory` delegate (non-E2E) and return `{ trashItemId }`; hard delete otherwise.
- [x] 3.3 `FilesService.relocateForTrash`: beforeMove hooks, storage move, sidecar, share links / grants / handles re-path, `afterTrash` hooks.
- [x] 3.4 Mark self-removed in hard delete and `move`.
- [x] 3.5 `RenameTrackingService`: skip self-removed unlinks (no correlator, no cleanup); record `deleted` for external `.md` unlinks (shared + personal, personal via a rename-only correlator); skip E2E.

## 4. TrashService, controller, retention

- [x] 4.1 `TrashService.trash`: count files, collect `.md`, relocate, re-path stars + PIN, tombstone handles, insert row, record `deleted` changes.
- [x] 4.2 `TrashService.list` (zone filtering, `canPurge`, drop rows whose folder vanished).
- [x] 4.3 `TrashService.restore`: permission, destination naming, move, re-path back, untombstone, `created` changes, internal-write + `file:written`.
- [x] 4.4 `TrashService.purge` / `emptyTrash` / `purgeOlderThan`.
- [x] 4.5 `TrashController`: `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id`, `DELETE /api/trash`.
- [x] 4.6 `TrashRetentionService` daily cron + `TRASH_RETENTION_DAYS` parsing.
- [x] 4.7 `TrashModule`; add to `app.module.ts` imports.
- [x] 4.8 Files controller delete endpoints return `trashItemId`.

## 5. OT

- [x] 5.1 `OTSessionManager.discardSession`.
- [x] 5.2 `OTService.discardSessionsUnder(src, trashPath)` writes dirty content to the trash copy then discards.
- [x] 5.3 `OTGateway` registers `afterTrash`: discard sessions, send `doc:trashed`.

## 6. Encryption, attachments, MCP

- [x] 6.1 `MigrationSweepService.walk` and `rotate-kek` `walk` descend into `.trash`.
- [x] 6.2 `EncryptingStorageAdapter.moveDirectoryReencrypt` carries comment sidecars.
- [x] 6.3 Attachments: test that a note under `.trash/` keeps its attachment referenced.
- [x] 6.4 MCP `delete_note`: description + response wording.

## 7. Backend tests

- [x] 7.1 Trash/restore/purge service tests: shared + personal, folder, collision naming, sidecar, handles same id, share link/grant/star/PIN dormant and revived, new note at same path starts clean, change rows.
- [x] 7.2 Permission tests: personal isolation (list/restore/purge 404), purge 403 for non-deleter, admin purge, owner purge, empty trash scope.
- [x] 7.3 `_secure` paths hard-delete; trash paths denied by visibility (read/move into trash 404).
- [x] 7.4 Rename tracking: self-removed unlink skipped; external unlink records `deleted`; rename pair does not.
- [x] 7.5 Retention parsing and `purgeOlderThan`.
- [x] 7.6 Encryption: sweep/rotate walk include `.trash`; encrypted move into trash re-binds AAD; folder re-encrypt keeps sidecars.
- [x] 7.7 OT discard: dirty content lands in the trash copy, no flush to the original path.
- [x] 7.8 Download zip excludes `.trash`.

## 8. Frontend

- [x] 8.1 `api.ts`: `deleteFile` / `deleteDirectory` return `trashItemId`; `listTrash`, `restoreTrashItem`, `purgeTrashItem`, `emptyTrash`.
- [x] 8.2 `utils/trash.ts`: pure helpers (folder label, relative time, sort) + vitest.
- [x] 8.3 `components/TrashDialog.tsx`.
- [x] 8.4 `App.tsx`: confirm modal wording, Undo toast, close active doc, `doc:trashed` handler, sidebar Trash entry, dialog wiring.
- [x] 8.5 `styles.css`: `/* ── Trash ── */` block.

## 9. E2E and verification

- [x] 9.1 `packages/e2e/tests/trash.spec.ts`: delete → Undo; delete → Trash dialog → Restore; Delete forever; collaborator editor closes. (Written, not run: the suite uses fixed ports; run after merge.)
- [x] 9.2 Backend build + new and neighbouring tests; frontend `tsc -b` + vitest.
- [x] 9.3 `openspec validate add-note-trash --strict`.
- [x] 9.4 `GET /api/files/read` sends `Cache-Control: no-store` on error responses, so a cached 410 can't outlive a restore (found by the post-merge e2e run).
- [x] 9.5 `secure-vault-setup-ui.spec.ts` step 5 confirms the new "Delete permanently?" dialog.

## 10. Side-effect audit (pre-merge)

- [x] 10.1 Exact, case-sensitive prefix matching (`substr`, as main's 331643f) in the prefix helpers trash/restore/purge reuse: `GrantsService.cascadeRename` / `cascadeDelete`, `DocHandlesService.updatePathPrefix`, `ShareLinksService.updatePathPrefix`, `RenameTrackingService.updatePathPrefix` (stars + changes). Tests: `my_notes` vs `my-notes`, `john_doe@` vs `john.doe@`, `100%` vs `100 percent`, through trash → restore → trash → purge.
- [x] 10.2 External unlink cleanup (share links, grants, handle tombstone) only runs when the note is still gone after the settle window; an atomic save (unlink + re-create) keeps them. Test added; a self-removed folder mark does not swallow look-alike siblings (test).
- [x] 10.3 Every delete, move or row cleanup keyed on `trash_items.trashPath` requires it to equal `trashPathFor(originalPath, id)`; a tampered row is refused and logged (test: purge, retention, empty, list, restore leave a live folder and its share link intact).
