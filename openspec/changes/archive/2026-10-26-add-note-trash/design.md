# Design: note trash

## Goal

Make delete reversible for a bounded time without changing how notes live on disk. A trashed note is still a plain `.md` file, in a folder Obsidian already treats as its trash.

## Layout on disk

| Zone | Trash root | Item path |
|---|---|---|
| Shared vault | `.trash/` | `.trash/<itemId>/<basename>` |
| Personal | `_users/{email}/.trash/` | `_users/{email}/.trash/<itemId>/<basename>` |

- `<itemId>` is 16 random hex characters, also the `trash_items` primary key. One sub-folder per item means two notes called `Plan.md` from different folders never collide, and restore never has to guess.
- A trashed folder keeps its structure: `.trash/<id>/Projects/a.md`, `.trash/<id>/Projects/sub/b.md`.
- Comment sidecars (`.<name>.collab`) move with the note. For folders they move with the folder rename.
- Attachments are not moved. They live in the zone's `_attachments/` and are shared by reference.
- Obsidian's own `.trash` entries (flat files with no `trash_items` row) are left alone: Kalepin's trash is driven by the table, so it neither lists nor purges them.

`LocalFSAdapter.list` and the chokidar watcher already ignore dot entries, so trashed content disappears from the tree, search, the link index, the graph and MCP `list_files` with no further change. The routing adapter accepts `.trash` segments (it only rejects `.`, `..` and the top-level `.deleted`). The git adapter is a `LocalFSAdapter`, so its move is the same `fs.rename`; `commitAll` will commit `.trash/` like any other folder.

## Data model

```
trash_items
  id              varchar(16) PK      -- also the sub-folder name
  originalPath    varchar  (index)
  trashPath       varchar  unique     -- <zone trash root>/<id>/<basename>
  kind            'file' | 'folder'
  zone            'shared' | 'personal'
  ownerEmail      varchar null        -- personal zone owner, null for shared
  deletedByEmail  varchar
  deletedByUserId integer null
  deletedAt       integer             -- unix ms
  itemCount       integer             -- files inside (1 for a file)
```

Doc-handle ids are not stored: the handle rows themselves move to the trash path (next section), so restore finds them by path.

## Bookkeeping follows the item (decision)

The brief suggested leaving share links, grants, stars, PIN and the doc handle at the original path while trashed. We re-path them into the trash path instead, exactly like a move, and make trash paths unreachable. Reasons:

1. **No inheritance by a new note at the same path.** If the rows stayed at `Plan.md` and someone created a new `Plan.md` before restoring, the new note would silently pick up the old public share link, the old grants (another user could read it), the old PIN, and `findOrCreateForPath` would reactivate the old tombstoned handle, so the new note would steal the trashed note's `/doc/<id>`.
2. **Restore after a collision still works.** When the original path is taken, the item comes back as `Plan (restored).md`. Re-pathing from the trash path to wherever it lands is the same operation either way.
3. **No grant GC.** `FilesService.listLiveGrantsForGrantee` revokes grants whose path is missing on disk. Grants left at a vanished original path would be revoked the first time the grantee opened their tree.

What makes the rows dormant is that every surface refuses trash paths:

| Surface | Trash-path behaviour |
|---|---|
| `isVisibleTo` / `GrantAwareVisibility` | `false` / `denied`, so every file, comment, history, PIN, OT and MCP route answers 404. API callers also cannot create, move or write inside a trash folder. |
| `ShareLinksService.resolve` | `not_found` (before the handle is minted) |
| `GrantsService.listForGrantee` / `listForGrantor` | filtered out, so "Shared with me", the tree's `_shared_with_me` root and "my shares" show no ghosts and nothing is GC'd |
| `StarsService.listByUser` | filtered out |
| `DocHandlesService.findOrCreateForPath` | never mints or reactivates a trash path |

Stars and `note_meta` (PIN) are re-pathed by TrashService directly (move does not carry them today: rename tracking re-paths stars only for watcher-detected renames, and PIN rows stay behind on move). Before re-pathing back on restore, stale rows at the destination are dropped. The destination does not exist on disk, so any row there belongs to a note deleted earlier.

`note_changes` rows are not re-pathed. History stays at the original path, and restore appends a `created` row there (or at the `(restored)` path).

## Doc handles

- Trash: re-path the handle rows to the trash path (exact + prefix), then tombstone them. `/doc/<id>` returns 410 and the frontend shows "This note no longer exists".
- Restore: re-path from the trash path to the restored path and clear the tombstone. Same id, so old links work again. `repathRow` already handles the race where the watcher mints a row for the restored path first: the moved row wins.
- Purge: rows stay tombstoned (handle rows are never deleted).
- `GET /api/files/read` sends `Cache-Control: no-store` on every error response (410, 404, 423); the success path keeps its revalidating policy. A 410 without a cache header is heuristically cacheable, so before this a browser that opened `/doc/<id>` while the note was trashed kept replaying the cached 410 after the restore. A tombstone used to be final, which is why it never mattered. Found by the e2e run after merge.

## Delete flow

`FilesService.deleteFile` / `deleteDirectory` keep their visibility and personal-root checks. Then:

- `_secure/` (E2E) path → today's permanent delete. The server cannot re-bind the envelope AAD to a new path.
- otherwise, when a trash handler is registered → `TrashService.trash(path, kind, actor)` and return `{ trashItemId }`.
- no handler (unit tests that build `FilesService` alone) → permanent delete as before.

The handler is registered by `TrashService.onModuleInit` (`filesService.setTrashHandler(this)`), the same inversion the OT gateway uses for move hooks. FilesService does not depend on TrashService.

`TrashService.trash`:

1. Count the files and collect the `.md` paths inside (folders), for change rows and `itemCount`.
2. Mark the source as a Kalepin-caused removal (`FileWatcherService.markSelfRemoved`).
3. `FilesService.relocateForTrash(src, trashPath, itemId)`: run `beforeMove` hooks (OT flushes live sessions), `storage.move` (the encrypting adapter re-encrypts so the AAD matches the new path, same as rename), move the sidecar, re-path share links / grants / doc handles, then run `afterTrash` hooks (OT drops the sessions). Wiki links are not rewritten and relative attachment paths are not rewritten: the note comes back to the same folder.
4. Re-path stars and PIN rows, tombstone the handles under the trash path.
5. Insert the `trash_items` row.
6. Record a `deleted` change for each `.md` path.

## Restore flow

1. Load the item; check the caller can see it and can write the original path (`assertWritable`).
2. Pick the destination: the original path if free, else `Name (restored).ext`, `Name (restored 2).ext`, … (folders: `Name (restored)`).
3. `storage.move(trashPath, dest)` creates missing parents.
4. Re-path share links, grants, handles, stars and PIN from the trash path to `dest`; clear the handle tombstones.
5. For each restored `.md`: record a `created` change with its content, emit an internal write (FTS, embeddings and link index re-index without waiting for chokidar), and emit `file:written` (OT reloads any session someone opened at that path in the meantime).
6. Delete the `trash_items` row.

The watcher also sees the `add` at `dest` and re-indexes. Double indexing is idempotent. The add is deliberately not deduplicated with `markRecentInternalWrite`, because the OT gateway's `file:tree-update` broadcast to other clients depends on it.

## Purge flow

Delete `<trash root>/<id>` from storage, then `shareLinks.deleteByPath` (exact + prefix), `grants.cascadeDelete`, delete star and PIN rows under the trash path, delete the `trash_items` row. Handles stay tombstoned. Purge happens inside a dot-folder, so the watcher sees nothing and no change rows are written: the `deleted` row was recorded at trash time.

## Permissions

| Action | Who |
|---|---|
| List | shared-zone items: every user; personal items: the folder owner only. Never another user's personal trash. |
| Restore | anyone who can list the item and can write the original location (`assertWritable(originalPath)`) |
| Purge | the user who deleted it, an admin (`isAdmin`), or the personal-folder owner for personal items |
| Empty trash | purges every listed item the caller may purge |

A hidden item answers 404, like a foreign personal path. A visible item the caller may not purge answers 403.

The owner rule for purge is a refinement of the brief ("the deleter or an admin"). A write-grantee can delete a note in someone else's personal folder; it lands in the owner's trash, and the owner must be able to empty their own trash. The grantee cannot see that trash, so their Undo answers 404. This is an accepted limitation.

## Live editors (OT)

`relocateForTrash` reuses `beforeMove` (flush every session at or under `src` before the move) and adds an `afterTrash` hook. The OT gateway's `afterTrash`:

- for every session at or under `src`: if it is dirty again (ops landed between flush and rename), write its content straight to the matching trash path; then discard the session without the close-time flush (`OTSessionManager.discardSession`);
- send `{ type: 'doc:trashed', docId, trashItemId, trashedPath }` to its clients and clear their `docId`. `trashedPath` is the trashed item (the doc, or the folder above it), so a client can follow the doc to wherever the item is restored.

Later ops for that doc find no session and are rejected, so nothing re-creates the file. The frontend closes the editor and shows a toast with a Restore action. The tab that issued the delete skips the toast: it already shows Undo.

## Watcher side effects

Moving a file into `.trash/` surfaces as an `unlink` of the original path; the destination is ignored. Today `RenameTrackingService` would, 500 ms later, delete the share links, revoke grants and tombstone the handle at that path. That is a no-op once the rows are re-pathed, but it would also hit a new note created at the same path in the meantime, and the correlator could pair the unlink with an unrelated `add` into a fake rename.

`FileWatcherService` gains a small registry of changes Kalepin caused itself (10 s TTL, prefix match for folders), with two kinds:

- `markSelfRemoved(path)`: trash, permanent delete, and the destination of a trash restore. `RenameTrackingService` ignores these events entirely: no correlator, no cleanup, no handle mint, no change row. Restored paths are marked so their `add` is not paired with a pending unlink into a fake rename.
- `markSelfMoved(path)`: the source of `FilesService.move`. Still fed to the correlator, because rename tracking is what re-paths stars and history for same-zone moves; it only stops an unpaired unlink (shared ↔ personal moves) from being recorded as an external delete.

Neither kind suppresses the event for other subscribers: search, the link index and the OT tree broadcast still see the unlink and drop the trashed note.

The internal-write dedup map (`markRecentInternalWrite`) is not used for trash moves: it would drop the unlink for every subscriber, including the indexes.

## External deletes

`RenameTrackingService` now records `deleted` (user `null`) when an `unlink` for a `.md` path is not self-removed, not E2E, and was not paired into a rename within the existing 500 ms window. Shared events go through the existing correlator. Personal events get a second correlator used only to recognise renames: personal external renames still do not re-path rows, which is today's behaviour.

The hard-delete branch marks its source self-removed; `FilesService.move` marks its source self-moved. A shared→personal move is an unlink in one watcher and an add in the other, which the per-zone correlator cannot pair.

The `deleted` row is skipped when the path exists again by the time the window closes: some platforms surface an atomic save as unlink + add of the same path.

## What a delete must never touch (pre-merge audit)

Three side effects were found by auditing every path that deletes, moves or re-points rows, and fixed before merge:

- **LIKE wildcards.** The prefix helpers that trash, restore and purge reuse (`GrantsService.cascadeRename` / `cascadeDelete`, `DocHandlesService.updatePathPrefix`, `ShareLinksService.updatePathPrefix`, `RenameTrackingService.updatePathPrefix`) matched `folder/%` unescaped, so `_` and `%` in a name were wildcards: trashing `my_notes` dragged the share links, grants and handles of `my-notes/…` into the trash and tombstoned them, purge revoked those grants, and `_users/john_doe@…` matched `_users/john.doe@…`. Folder renames had the same flaw before this change; main fixed them independently (331643f) with an exact, case-sensitive prefix test, `substr(path, 1, length(:p)) = :p`, which this change adopts everywhere, including its own trash queries.
- **Atomic saves.** The external-unlink cleanup (delete share link, revoke grants, tombstone handle) predates this change and ran even when the file was back on disk. It now applies the same "still gone after the window?" check as the `deleted` row.
- **Corrupted rows.** Purge deletes `dirname(trashPath)` recursively. Every delete, move or row cleanup keyed on `trashPath` now requires it to equal `trashPathFor(originalPath, id)`; anything else is refused and logged, and the row is kept for an operator.

## Encryption

- `EncryptingStorageAdapter.move` already re-encrypts when either end is encrypted at rest, so moves into and out of `.trash` re-bind the AAD exactly as rename does.
- `moveDirectoryReencrypt` walked `inner.list`, which skips dot entries, then `rm -rf`'d the source, so comment sidecars inside a re-encrypted folder were lost. This affected folder renames too. It now also carries `.<name>.collab` siblings of each file it moves.
- `MigrationSweepService.walk` and `rotate-kek`'s `walk` skipped every dot entry. Through a shared predicate (`encryption/sweep-entry-filter.ts`) they now descend into the zone trash folders, `.trash/` at the shared root and `{email}/.trash/` under the personal root, and keep skipping every other dot entry (`.deleted`, `.obsidian`, sidecars, `_attachments/.trash`). Otherwise trashed files would keep the old KEK and become unreadable once it is destroyed.

## Attachments

`AttachmentsService.scanReferences` walks the zone root with raw `readdir` and does not skip dot folders, so notes under `.trash/` already count as references and their attachments survive the orphan sweep. A unit test pins this down so a future "skip dot folders" optimisation cannot break restore.

## Backups and exports

- Admin backup (`ArchiveService.createArchive`) tars the physical vault and personal roots, dot-folders included, together with the SQLite file. `.trash/` and `trash_items` are therefore backed up and restored together.
- The per-user vault zip (`GET /api/files/download-zip`) walks `storage.list`, which skips dot entries, so it never contains the trash.

## Retention

`TrashRetentionService` runs `@Cron(EVERY_DAY_AT_4AM)`, an hour after the access-log prune, and purges items whose `deletedAt` is older than `TRASH_RETENTION_DAYS` days (default 30). `0` disables auto-purge. Invalid values fall back to 30, matching `ACCESS_LOG_RETENTION_DAYS` parsing.

## API

```
GET    /api/trash                 → { retentionDays, items: TrashItemDto[] }      notes:read
POST   /api/trash/:id/restore     → { id, path, kind }                            notes:delete
DELETE /api/trash/:id             → { purged: id }                                notes:delete
DELETE /api/trash                 → { purged: n }                                 notes:delete

TrashItemDto = { id, name, originalPath, originalFolder, kind, zone,
                 deletedByEmail, deletedAt, itemCount, canPurge }

DELETE /api/files/delete?path=    → { deleted, trashItemId: string | null }
DELETE /api/files/directory?path= → { deleted, trashItemId: string | null }
```

`trashItemId` is `null` when the path was deleted permanently (`_secure/`). Restore and purge use the `notes:delete` scope: undoing a delete is part of deleting.

Items whose trash folder vanished from disk (for example someone emptied `.trash` from Obsidian) are dropped from the table when listed or restored.

## Frontend

- Context menu "Delete" / "Delete folder…" open a `ConfirmModal`: title "Move to trash?", confirm "Move to trash". `_secure/` items say "Delete permanently?" because they skip the trash.
- After a trash delete: reload the tree and stars, drop the path from Recent, close the editor if the active doc was inside, and show a toast "Moved “X” to trash" with **Undo** (restore, then re-open the doc if it was active).
- A **Trash** row pinned to the bottom of the sidebar opens `TrashDialog`: a list with name, original folder, deleted by, relative time, file count for folders, **Restore** and **Delete forever** buttons (the latter hidden when `canPurge` is false), the retention hint, and **Empty trash** behind a `ConfirmModal`.
- `doc:trashed` WS frame: if it is the active doc, close the editor and toast "“X” was moved to trash" with **Restore**, unless this tab issued the delete.

## Risks

- **Trash bookkeeping failures.** If a re-path step fails after the item has moved, the delete still succeeds and the item stays listed and restorable; the error is logged. If the move itself fails, the row is dropped and the error surfaces.
- **Stale stars in other tabs.** Other users' starred lists are loaded once per session, so a star on a note someone else trashed stays visible until reload (opening it answers 404).
- **Timing of the watcher.** Self-removal marks last 10 s. A chokidar backlog longer than that would let a trash unlink through to rename tracking, which would record a spurious `deleted` row (harmless: one was already recorded) and run its cleanup on the original path, which is empty by then.
- **Grantee deletes.** See Permissions: a write-grantee's delete lands in the owner's trash and the grantee's Undo fails with 404.
- **Large folders.** Trash and restore walk the folder once to collect `.md` paths and re-index on restore. That is acceptable for typical folders; very large folders take as long as a move.
- **Comment sidecars and encryption sweeps.** Sidecars (`.x.md.collab`) are still skipped by the encryption sweeps, inside and outside `.trash`. That gap predates this change and is left as is.
