## ADDED Requirements

### Requirement: Deleting moves notes and folders to a per-zone trash

The system SHALL move a deleted note or folder into the trash folder of its zone instead of removing it from storage: `.trash/` at the shared vault root, `_users/{email}/.trash/` for a personal folder. Each item SHALL be stored under its own sub-folder `<trash root>/<itemId>/<basename>`, with folders keeping their inner structure. A note's comment sidecar SHALL move with it. Attachments SHALL NOT be moved. The system SHALL record a `trash_items` row with the item id, original path, trash path, kind (`file` or `folder`), zone, the deleting user's email and id, the deletion time and the number of files the item contains. This applies to the file-tree UI, `DELETE /api/files/delete`, `DELETE /api/files/directory` and the MCP `delete_note` tool.

#### Scenario: Delete a shared note
- **WHEN** Alice deletes `Projects/Plan.md`
- **THEN** the file is stored at `.trash/<id>/Plan.md` and no longer exists at `Projects/Plan.md`
- **AND** a `trash_items` row records `originalPath = 'Projects/Plan.md'`, `kind = 'file'`, `zone = 'shared'`, `deletedByEmail = alice`
- **AND** the response to `DELETE /api/files/delete` includes `trashItemId = <id>`

#### Scenario: Delete a personal folder
- **WHEN** Alice deletes `_users/alice@x.com/Drafts` containing two notes
- **THEN** the folder is stored at `_users/alice@x.com/.trash/<id>/Drafts` with both notes inside
- **AND** the row records `kind = 'folder'`, `zone = 'personal'`, `itemCount = 2`

#### Scenario: Comment sidecar travels with the note
- **WHEN** a note with comments is deleted
- **THEN** its `.<name>.collab` sidecar is stored next to it in the trash item folder

#### Scenario: Same name deleted twice
- **WHEN** `A/Plan.md` and `B/Plan.md` are both deleted
- **THEN** they are stored under two different item folders and both can be restored

#### Scenario: Trashed items are hidden from the vault
- **WHEN** a note is in the trash
- **THEN** it does not appear in the file tree, search results, backlinks, the graph or MCP `list_files`

### Requirement: End-to-end encrypted paths are deleted permanently

Paths under `_users/{email}/_secure/` SHALL keep the permanent delete behaviour. They SHALL NOT be moved to the trash and the delete response SHALL carry `trashItemId = null`.

#### Scenario: Delete an encrypted note
- **WHEN** Alice deletes `_users/alice@x.com/_secure/diary.md`
- **THEN** the file is removed from storage and no `trash_items` row is created
- **AND** the response carries `trashItemId: null`

### Requirement: Trash paths are not reachable through the API

Paths at or under a trash root (`.trash` at the vault root, `_users/{email}/.trash`) SHALL be treated as not visible by the visibility predicates, so every file, comment, history, PIN, OT and MCP route answers as for a missing path. Clients SHALL NOT be able to create, write, move or delete anything inside a trash folder through the file APIs.

#### Scenario: Read a trash path directly
- **WHEN** a user requests `GET /api/files/read?path=.trash/<id>/Plan.md`
- **THEN** the response is `404`

#### Scenario: Move a note into the trash folder by hand
- **WHEN** a user calls `POST /api/files/move` with `dest = '.trash/x.md'`
- **THEN** the response is `404` and nothing moves

### Requirement: Sharing, stars, PIN and handles are dormant while trashed

When an item is trashed, its share links, grants, stars, per-note PIN and doc handles SHALL follow it to the trash path, and SHALL be dormant while it is there:

- share-link resolution for a trashed note SHALL answer as for an unknown code;
- grant listings ("shared with me", the tree's shared-with-me root, the grantor's list) SHALL omit trashed paths and SHALL NOT revoke their grants;
- the starred list SHALL omit trashed paths;
- doc handles SHALL be tombstoned, so `/api/files/read?handle=<id>` answers `410 { tombstoned: true }`;
- a new note created at the original path SHALL NOT inherit any of them.

Restore SHALL revive all of them at the restored path, keeping the same share code, grant rows and handle id.

#### Scenario: Share link while trashed
- **GIVEN** `Plan.md` has an active public share link and is trashed
- **WHEN** an anonymous visitor resolves the link
- **THEN** the response is `404`

#### Scenario: Grantee does not see a ghost
- **GIVEN** Alice granted Bob read access to `_users/alice@x.com/Plan.md` and trashed it
- **WHEN** Bob lists "shared with me"
- **THEN** the note is not listed and the grant is not revoked

#### Scenario: Handle while trashed and after restore
- **GIVEN** `Plan.md` has handle `H` and is trashed
- **WHEN** a client reads `?handle=H`
- **THEN** the response is `410` with `{ tombstoned: true }`
- **WHEN** the item is restored
- **THEN** reading `?handle=H` returns the note again

#### Scenario: New note at the same path starts clean
- **GIVEN** `Plan.md` with a share link, a grant and handle `H` is trashed
- **WHEN** a user creates a new `Plan.md`
- **THEN** the new note gets a new handle, no share link and no grant

### Requirement: Listing the trash

`GET /api/trash` SHALL return the trash items the caller may see, newest first: every shared-zone item, and the personal items of the caller's own folder. Items in another user's personal trash SHALL never be listed. Each entry SHALL carry the item name, original path, original folder, kind, zone, deleting user's email, deletion time, file count and whether the caller may purge it. The response SHALL include the configured retention in days. Items whose trash folder no longer exists on disk SHALL be dropped.

#### Scenario: Personal trash isolation
- **GIVEN** Alice trashed a personal note and Bob trashed a shared note
- **WHEN** Bob lists the trash
- **THEN** he sees his shared item and not Alice's personal item

### Requirement: Restoring a trashed item

`POST /api/trash/:id/restore` SHALL move the item back to its original path, recreating missing parent folders, when the caller can see the item and can write the original location. If the original path is taken, the item SHALL be restored next to it as `Name (restored).ext`, then `Name (restored 2).ext`, and so on (folders: `Name (restored)`). The response SHALL carry the restored path. Restore SHALL re-index the restored notes for search and links and SHALL remove the `trash_items` row. An item the caller cannot see SHALL answer `404`.

#### Scenario: Restore to the original path
- **WHEN** Alice restores the item for `Projects/Plan.md` and `Projects/` was deleted meanwhile
- **THEN** `Projects/` is recreated and the note is at `Projects/Plan.md` with its comments

#### Scenario: Restore when the path is taken
- **GIVEN** a new `Projects/Plan.md` was created after the original was trashed
- **WHEN** the original is restored
- **THEN** it is restored as `Projects/Plan (restored).md` and the new note is untouched

#### Scenario: Restore someone else's personal item
- **WHEN** Bob calls restore on an item from Alice's personal trash
- **THEN** the response is `404`

### Requirement: Purging and emptying the trash

`DELETE /api/trash/:id` SHALL permanently delete the item from storage and remove its share links, grants, stars and PIN rows; its doc handles stay tombstoned. Only the user who deleted the item, an admin, or (for personal items) the folder owner MAY purge it; another user who can see the item SHALL get `403`. `DELETE /api/trash` SHALL purge every item the caller can see and may purge, and return how many were purged.

#### Scenario: Purge by the deleter
- **WHEN** Alice purges an item she deleted
- **THEN** the files are removed from storage and the row is gone

#### Scenario: Purge by another user
- **WHEN** Bob purges a shared item Alice deleted and Bob is not an admin
- **THEN** the response is `403` and the item stays

#### Scenario: Empty trash
- **WHEN** Alice empties the trash
- **THEN** every item she may purge is purged and items deleted by others stay

### Requirement: Automatic purge after the retention period

The system SHALL purge, once a day, the trash items deleted more than `TRASH_RETENTION_DAYS` days ago (default 30). A value of `0` SHALL disable automatic purge.

#### Scenario: Old item purged
- **GIVEN** `TRASH_RETENTION_DAYS=30` and an item deleted 31 days ago
- **WHEN** the daily retention job runs
- **THEN** the item is purged

#### Scenario: Retention disabled
- **GIVEN** `TRASH_RETENTION_DAYS=0`
- **WHEN** the daily retention job runs
- **THEN** nothing is purged

### Requirement: Open editors close when their note is trashed

When a note open in a live OT session is trashed, the system SHALL persist the session's latest content into the trashed copy, drop the session and send `{ type: 'doc:trashed', docId, trashItemId }` to its clients. Later edits for that doc SHALL be rejected and SHALL NOT re-create the file at the original path. The client SHALL close the editor and offer to restore the note.

#### Scenario: Collaborator has the note open
- **GIVEN** Bob is editing `Plan.md`
- **WHEN** Alice moves it to the trash
- **THEN** Bob's editor closes with a "moved to trash" notice
- **AND** `Plan.md` does not reappear at its original path

### Requirement: Trash UI

The UI SHALL confirm a delete with "Move to trash" wording, show a toast with an Undo action after a delete that went to the trash, and offer a Trash entry at the bottom of the sidebar that opens a list of trash items with their name, original folder, deleting user, relative time and file count, a Restore action, a Delete forever action when the user may purge, and an "Empty trash" action behind a confirmation.

#### Scenario: Undo after delete
- **WHEN** a user moves a note to the trash from the file tree and clicks Undo on the toast
- **THEN** the note is back in the tree at its original path

### Requirement: MCP delete_note moves the note to the trash

The MCP `delete_note` tool SHALL move the note to the trash. Its description and its response SHALL state that the note can be restored from Trash. No new MCP tool is added.

#### Scenario: Agent deletes a note
- **WHEN** an MCP client calls `delete_note` on `Plan.md`
- **THEN** the note is moved to the trash and the response says it can be restored from Trash

### Requirement: Trashed content stays covered by encryption maintenance

The at-rest encrypt/decrypt sweep and the `rotate-kek` CLI SHALL process files under `.trash/` folders, while still skipping other dot entries. Moving an item into or out of the trash in an encrypted zone SHALL re-encrypt it for its new path, like a rename.

#### Scenario: KEK rotation covers the trash
- **GIVEN** an encrypted shared zone with a trashed note
- **WHEN** an admin runs `rotate-kek`
- **THEN** the trashed note's envelope is re-wrapped with the new KEK

### Requirement: Backups include the trash, user exports do not

Admin backups SHALL include trash folders and the `trash_items` table. The per-user vault zip download SHALL NOT include trash folders.

#### Scenario: User zip
- **WHEN** a user downloads their vault zip while the shared trash holds items
- **THEN** no entry in the zip is under `.trash/`
