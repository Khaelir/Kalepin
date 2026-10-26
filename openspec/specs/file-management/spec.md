## Purpose

Create, read, update, delete, and move files and folders in the note workspace.
## Requirements
### Requirement: File CRUD operations
The system SHALL provide REST API endpoints for creating, reading, updating, and deleting markdown files in the vault. File create SHALL ensure a `doc_handles` row exists for the new path. File delete SHALL move the file to its zone's trash (see `note-trash`) and tombstone the matching `doc_handles` row; paths under `_secure/` SHALL be removed permanently and their row tombstoned.

#### Scenario: Create a new file
- **WHEN** a user creates a new file via the API with a path and optional initial content
- **THEN** the system creates the markdown file on disk, ensures a `doc_handles` row exists for the path, and returns the file metadata including `handle.id`

#### Scenario: Read a file
- **WHEN** a user requests a file by path
- **THEN** the system returns the file content and metadata, including `handle.id` and `handle.path`

#### Scenario: Delete a file
- **WHEN** a user deletes a file by path
- **THEN** the system moves the file and its sidecar file (if exists) to the trash, sets `tombstone_at` on the matching `doc_handles` row, and returns `{ deleted, trashItemId }`

#### Scenario: Delete an end-to-end encrypted file
- **WHEN** a user deletes a file under `_users/{email}/_secure/`
- **THEN** the system removes the file and its sidecar from disk, sets `tombstone_at` on the matching `doc_handles` row, and returns `trashItemId: null`

### Requirement: Read endpoint accepts handle in addition to path

`GET /api/files/read` SHALL accept either `?path=<path>` or `?handle=<id>`. When `handle` is provided, the system SHALL resolve via `DocHandlesService` first; tombstoned handles return `410 Gone` with `{ tombstoned: true }` and unknown handles return `404`. The response SHALL always include `handle: { id, path }` so clients can normalize internal URLs to the handle form.

#### Scenario: Read by handle
- **GIVEN** an active handle `H` for path `Notes/Foo.md` and a user with read access
- **WHEN** the client GETs `/api/files/read?handle=H`
- **THEN** the response is `200` with body containing `handle.id = H` and `handle.path = 'Notes/Foo.md'`

#### Scenario: Read by path also returns handle
- **GIVEN** an active handle exists for `Notes/Foo.md`
- **WHEN** the client GETs `/api/files/read?path=Notes/Foo.md`
- **THEN** the response includes `handle.id` and `handle.path = 'Notes/Foo.md'`

#### Scenario: Read by path mints a handle if absent
- **GIVEN** no handle row exists for `Notes/Foo.md`
- **WHEN** the client GETs `/api/files/read?path=Notes/Foo.md`
- **THEN** the response includes a freshly-minted `handle.id`
- **AND** subsequent reads return the same handle

#### Scenario: Read by tombstoned handle
- **GIVEN** a tombstoned handle `H`
- **WHEN** the client GETs `/api/files/read?handle=H`
- **THEN** the response is `410` with body `{ tombstoned: true }`

#### Scenario: Read by unknown handle
- **GIVEN** no row matches handle `Q`
- **WHEN** the client GETs `/api/files/read?handle=Q`
- **THEN** the response is `404`

### Requirement: Directory management
The system SHALL support creating, renaming, moving, and deleting directories in the vault. Deleting a directory SHALL move it, with its whole content, to its zone's trash.

#### Scenario: Create a directory
- **WHEN** a user creates a new directory at a given path
- **THEN** the system creates the directory on disk

#### Scenario: Delete a non-empty directory
- **WHEN** a user deletes a directory that contains files
- **THEN** the system moves the directory and all its contents to the trash (with confirmation) and returns `{ deleted, trashItemId }`

### Requirement: File and directory move/rename
The system SHALL support moving and renaming files and directories. When a file is moved, its sidecar file MUST move with it. When a file is moved, any associated share-link path MUST be updated. When a file is moved, the matching `doc_handles` row's `path` MUST be updated and the handle ID preserved.

#### Scenario: Rename a file
- **WHEN** a user renames a file from `old.md` to `new.md`
- **THEN** the system renames the file and its sidecar (`.old.md.collab` → `.new.md.collab`) on disk
- **AND** the `doc_handles` row's `path` is updated to `new.md`; the ID is unchanged

#### Scenario: Move a file to another directory
- **WHEN** a user moves a file to a different directory
- **THEN** the system moves both the file and its sidecar to the new location
- **AND** the `doc_handles` row's `path` is updated to the new path; the ID is unchanged

#### Scenario: Rename a file that has a share link
- **WHEN** a user renames or moves a file that has an associated share link
- **THEN** the system updates the `short_links` row to reflect the new path, preserving the same short code
- **AND** the `doc_handles` row is likewise updated, preserving the handle ID

### Requirement: File tree listing
The system SHALL provide an API endpoint that returns the hierarchical file tree of the vault.

#### Scenario: List file tree
- **WHEN** a user requests the file tree
- **THEN** the system returns a recursive listing of all files and directories in the vault, excluding dot-prefixed files (sidecars, `.obsidian/`)

### Requirement: External edit detection
The system SHALL detect when files are modified externally (e.g., via Obsidian or a text editor) using chokidar file watching. External `add` events for files without a `doc_handles` row SHALL mint a row; external `unlink` events SHALL tombstone the matching row and record a `deleted` change for `.md` paths; paired `unlink`+`add` reconciled by `rename-correlator` SHALL update the row's `path` instead of tombstoning + minting. `unlink` events for removals Kalepin itself caused (trash, permanent delete, move) SHALL be ignored by rename tracking but still reach the search and link indexes.

#### Scenario: File changed externally while open
- **WHEN** a file is modified on disk by an external process while users have it open in Kalepin
- **THEN** the server broadcasts a `file:changed` event to connected clients, and the client displays a toast notification and reloads the document content

#### Scenario: File changed externally while not open
- **WHEN** a file is modified on disk while no users have it open
- **THEN** the file tree updates to reflect the change (no notification needed)

#### Scenario: File created or deleted externally
- **WHEN** a file is created or deleted on disk by an external process
- **THEN** the file tree updates accordingly for all connected clients

#### Scenario: File created externally
- **WHEN** chokidar emits `add` for a new file path with no existing handle
- **THEN** the system mints a fresh `doc_handles` row for that path

#### Scenario: File deleted externally
- **WHEN** chokidar emits `unlink` for a path with a known handle
- **THEN** the system sets `tombstone_at` on that row
- **AND** for a `.md` path outside `_secure/`, the system records a `deleted` change with no user

#### Scenario: External rename reconciled by correlator
- **WHEN** chokidar emits `unlink(old)` followed by `add(new)` within the correlation window
- **THEN** the system updates the existing handle's `path` from `old` to `new`; no tombstone is created, no new ID is minted and no `deleted` change is recorded

#### Scenario: Removal caused by Kalepin
- **WHEN** chokidar emits `unlink` for a path Kalepin just moved to the trash
- **THEN** rename tracking neither cleans up share links, grants or handles nor records a change for it
- **AND** search and the link index drop the path

### Requirement: Tree includes shared-with-me virtual section

`GET /api/files/tree` SHALL include grant-visible paths grouped under a virtual `_shared_with_me` root for the requester. Foreign personal paths NOT covered by an active grant remain absent.

#### Scenario: Bob's tree includes Alice's shared note
- **GIVEN** Alice has an active read grant for Bob on `_users/alice/foo.md`
- **WHEN** Bob calls `GET /api/files/tree`
- **THEN** the response includes a `_shared_with_me/from-alice@x.com/foo.md` virtual entry
- **AND** other paths in Alice's personal folder are absent

### Requirement: Move rewrites grant paths atomically

When `POST /api/files/move` succeeds, all active grants on the moved path or its subtree SHALL have their `path` column updated in the same transaction.

#### Scenario: Move preserves grants
- **GIVEN** a grant on `_users/alice/old.md` for Bob
- **WHEN** Alice moves the note to `_users/alice/folder/new.md`
- **THEN** the grant's `path` is `_users/alice/folder/new.md` and Bob's next read at the new path succeeds

