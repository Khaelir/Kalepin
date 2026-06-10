# Spec delta: file-management (MODIFIED)

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: File CRUD operations
The system SHALL provide REST API endpoints for creating, reading, updating, and deleting markdown files in the vault. File create SHALL ensure a `doc_handles` row exists for the new path; file delete SHALL set `tombstone_at` on the matching row instead of removing it.

#### Scenario: Create a new file
- **WHEN** a user creates a new file via the API with a path and optional initial content
- **THEN** the system creates the markdown file on disk, ensures a `doc_handles` row exists for the path, and returns the file metadata including `handle.id`

#### Scenario: Read a file
- **WHEN** a user requests a file by path
- **THEN** the system returns the file content and metadata, including `handle.id` and `handle.path`

#### Scenario: Delete a file
- **WHEN** a user deletes a file by path
- **THEN** the system removes the file from disk and its sidecar file (if exists), and sets `tombstone_at` on the matching `doc_handles` row

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

### Requirement: External edit detection
The system SHALL detect when files are modified externally (e.g., via Obsidian or a text editor) using chokidar file watching. External `add` events for files without a `doc_handles` row SHALL mint a row; external `unlink` events SHALL tombstone the matching row; paired `unlink`+`add` reconciled by `rename-correlator` SHALL update the row's `path` instead of tombstoning + minting.

#### Scenario: File changed externally while open
- **WHEN** a file is modified on disk by an external process while users have it open in Kalepin
- **THEN** the server broadcasts a `file:changed` event to connected clients, and the client displays a toast notification and reloads the document content

#### Scenario: File created externally
- **WHEN** chokidar emits `add` for a new file path with no existing handle
- **THEN** the system mints a fresh `doc_handles` row for that path

#### Scenario: File deleted externally
- **WHEN** chokidar emits `unlink` for a path with a known handle
- **THEN** the system sets `tombstone_at` on that row

#### Scenario: External rename reconciled by correlator
- **WHEN** chokidar emits `unlink(old)` followed by `add(new)` within the correlation window
- **THEN** the system updates the existing handle's `path` from `old` to `new`; no tombstone is created and no new ID is minted
