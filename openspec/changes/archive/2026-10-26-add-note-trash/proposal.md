# Trash for deleted notes and folders

## Why

Deletes are permanent today. `FilesService.deleteFile` and `deleteDirectory` remove the file (and its comment sidecar) from storage, revoke its share links and grants and tombstone its doc handle. The only way back is an admin backup restore, which rolls back the whole vault. One mis-click in the file tree, one wrong `delete_note` call from an MCP client, or a folder deleted by a collaborator loses work with no undo.

Obsidian users already expect a `.trash/` folder at the vault root. Kalepin should behave the same: deleting moves the item aside, it can be restored or purged, and it goes away on its own after a while.

Two related gaps get fixed on the way:

- Deleting a folder records nothing in `note_changes`, so the Changes panel and MCP `get_updates` never report the notes it contained.
- Files deleted on disk by another tool (Obsidian, a shell) never get a `deleted` change row, because change tracking does not listen to the file watcher.

## What Changes

- **Delete moves to trash.** Deleting a note or folder from the UI, `DELETE /api/files/delete`, `DELETE /api/files/directory`, or MCP `delete_note` moves it to a per-zone trash folder: `.trash/` at the shared vault root, `_users/{email}/.trash/` for a personal folder. Each item gets its own sub-folder (`.trash/<itemId>/<basename>`), so names never collide; folders keep their inner structure. Comment sidecars travel with their note. Attachments stay where they are (they are shared by reference).
- **`trash_items` table** records each item: original path, trash path, kind, zone, who deleted it and when, and the file count for folders.
- **Bookkeeping follows the item.** Share links, grants, stars, the per-note PIN and doc handles are re-pathed into the trash path, the same way a move re-paths them. Paths under a trash folder are invisible to every API (visibility predicates, share-link resolution, grant lists, stars), so these rows are dormant while trashed. Doc handles are tombstoned, so `/doc/<id>` shows the existing "no longer exists" card. Restore moves everything back and keeps the same handle id.
- **Restore** goes to the original path, recreating missing parent folders. If the path is taken, the item is restored as `Name (restored).md`, then `Name (restored 2).md`, and so on.
- **Purge** deletes the item from disk and does the cleanup a delete does today (share links, grants, stars, PIN rows). **Empty trash** purges everything the caller may purge.
- **Retention.** A daily job purges items older than `TRASH_RETENTION_DAYS` (default 30; `0` disables it).
- **API**: `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id`, `DELETE /api/trash`. The two existing delete endpoints keep their routes; their response gains `trashItemId` so the UI can offer Undo.
- **MCP**: `delete_note` now moves the note to the trash; its description and response say it can be restored from Trash. No new tools.
- **Change tracking**: a `deleted` row for every `.md` file trashed, including each file inside a trashed folder; restore records `created` with the content. Files deleted on disk by another tool now record `deleted` too, unless Kalepin caused the removal or it is half of a rename.
- **Open editors**: when an open note is trashed, its live OT session is flushed into the trash copy and dropped, and connected clients get a `doc:trashed` frame. The editor closes instead of re-creating the file on the next save.
- **Encryption maintenance**: the encrypt/decrypt sweep and `rotate-kek` now walk `.trash/`, so trashed files stay readable after a KEK rotation.
- **UI**: delete confirmations say "Move to trash"; after a delete a toast offers Undo; a Trash entry at the bottom of the sidebar opens a Trash dialog listing items with Restore / Delete forever and an "Empty trash" button behind a confirmation.
- **Out of scope**: `_secure/` (end-to-end encrypted) paths keep today's permanent delete. The envelope AAD binds the path and the server cannot re-encrypt, so they cannot be moved into the trash.

## Capabilities

### New Capabilities

- `note-trash`: soft delete into per-zone trash folders, listing, restore, purge, empty, retention, and the dormant-bookkeeping rules while an item is trashed.

### Modified Capabilities

- `file-management`: delete endpoints move to trash (except `_secure/`) and return `trashItemId`; external deletes record a change.
- `change-tracking`: folder deletes record one `deleted` row per note; restore records `created`; external deletes are recorded.
- `attachment-cleanup`: notes in a trash folder count as references, so a restorable note keeps its attachments.

## Impact

- **Backend**
  - New `packages/backend/src/trash/` module: `TrashService`, `TrashController`, `TrashRetentionService`, path helpers.
  - New entity `entities/trash-item.entity.ts`, registered in `entities/index.ts` and `app.module.ts`.
  - `auth/visibility.ts`: `isTrashPath`; `isVisibleTo` and `GrantAwareVisibility` deny trash paths.
  - `files/files.service.ts`: delete delegates to the trash handler; `relocateForTrash` move primitive; `afterTrash` move hook; self-removal marking.
  - `files/file-watcher.service.ts`: short-lived registry of removals Kalepin caused.
  - `files/rename-tracking.service.ts`: skips self-caused unlinks; records `deleted` for external deletes in both zones.
  - `ot/`: `doc:trashed` frame, session discard.
  - `share-links`, `grants`, `stars`, `doc-handles`: trash paths resolve as not found / are filtered; prefix helpers.
  - `encryption/migration-sweep.service.ts`, `cli/rotate-kek.ts`: walk `.trash/`.
  - `storage/encrypting-fs.adapter.ts`: folder re-encrypting moves carry comment sidecars.
  - `mcp/mcp.service.ts`: `delete_note` wording.
- **Frontend**: `api.ts` (trash calls), `App.tsx` (confirmation, Undo toast, `doc:trashed`, sidebar entry), new `components/TrashDialog.tsx`, `utils/trash.ts`, `styles.css` (Trash block).
- **Config**: new env `TRASH_RETENTION_DAYS`.
- **Data**: new `trash_items` table (TypeORM `synchronize`). Backups already include dot-folders, so `.trash/` and `trash_items` are backed up together. The per-user vault zip skips dot-folders, so it does not include the trash.
