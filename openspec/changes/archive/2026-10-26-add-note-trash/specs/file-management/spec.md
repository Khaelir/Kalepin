## MODIFIED Requirements

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

### Requirement: Directory management
The system SHALL support creating, renaming, moving, and deleting directories in the vault. Deleting a directory SHALL move it, with its whole content, to its zone's trash.

#### Scenario: Create a directory
- **WHEN** a user creates a new directory at a given path
- **THEN** the system creates the directory on disk

#### Scenario: Delete a non-empty directory
- **WHEN** a user deletes a directory that contains files
- **THEN** the system moves the directory and all its contents to the trash (with confirmation) and returns `{ deleted, trashItemId }`

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
