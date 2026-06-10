# Spec delta: doc-handles (ADDED)

## ADDED Requirements

### Requirement: Each file has a durable opaque handle

The system SHALL maintain a `doc_handles` table keyed by an opaque 16-character base32 ID (`A-Z2-7`, crypto-random, collision-checked). Each row maps an ID to a single file `path` with a `created_at` timestamp and a nullable `tombstone_at`. The ID SHALL persist across rename and move; only file deletion sets `tombstone_at`.

#### Scenario: Lazy mint on first observation
- **GIVEN** a file `Notes/Foo.md` exists in the vault with no row in `doc_handles`
- **WHEN** any read or chokidar `add` event observes the path
- **THEN** the system inserts a `doc_handles` row with a fresh ID and returns it
- **AND** subsequent observations of the same path return the same ID

#### Scenario: Idempotent mint
- **GIVEN** a row already exists for `Notes/Foo.md`
- **WHEN** `findOrCreateForPath('Notes/Foo.md')` is called
- **THEN** the existing ID is returned and no new row is inserted

#### Scenario: ID format
- **WHEN** the system generates a new handle ID
- **THEN** the value matches `^[A-Z2-7]{16}$`

### Requirement: Resolving a handle returns path or tombstone

`DocHandlesService.resolve(id)` SHALL return `{ path, tombstoned: false }` for an active row, `{ path: <last-known>, tombstoned: true }` for a tombstoned row, and throw `NotFoundError` for an unknown ID.

#### Scenario: Active handle resolves to path
- **GIVEN** a row `(id=ABCD2345EFGH6789, path=Notes/Foo.md, tombstone_at=null)`
- **WHEN** `resolve('ABCD2345EFGH6789')` is called
- **THEN** the response is `{ path: 'Notes/Foo.md', tombstoned: false }`

#### Scenario: Tombstoned handle returns tombstone marker
- **GIVEN** a row with `tombstone_at` set
- **WHEN** `resolve(id)` is called
- **THEN** the response is `{ path, tombstoned: true }`

#### Scenario: Unknown handle
- **GIVEN** no row matching the ID
- **WHEN** `resolve(id)` is called
- **THEN** `NotFoundError` is thrown

### Requirement: Rename and move preserve the handle

When a file is renamed or moved (via API or via paired chokidar `unlink` + `add` reconciled by `rename-correlator`), the system SHALL update the existing `doc_handles` row's `path` instead of minting a new ID.

#### Scenario: API rename preserves ID
- **GIVEN** a row `(id=X, path=Notes/Foo.md)`
- **WHEN** the file is renamed to `Notes/Bar.md` via `POST /api/files/rename`
- **THEN** the row becomes `(id=X, path=Notes/Bar.md)` in the same transaction as the disk rename
- **AND** the public-share row for that path (if any) is updated identically (existing `file-management:Rename a file that has a share link`)

#### Scenario: External rename (paired by correlator) preserves ID
- **GIVEN** Obsidian renames a file on disk
- **WHEN** chokidar emits `unlink` followed by `add` and `rename-correlator` pairs them within the correlation window
- **THEN** the existing handle's `path` is updated; no tombstone is created and no new ID is minted

#### Scenario: External unpaired rename creates a new ID
- **GIVEN** an external rename whose `unlink` and `add` events fall outside the correlation window
- **WHEN** the events are processed independently
- **THEN** the original handle is tombstoned and a new handle is minted for the new path
- **AND** the old URL returns 410 with `{ tombstoned: true }`; the file remains reachable via the file tree under its new ID

### Requirement: Delete tombstones the handle

`FilesService.delete(path)` SHALL set `tombstone_at = now` on the matching row after the disk delete succeeds. The row SHALL NOT be removed.

#### Scenario: API delete tombstones
- **GIVEN** a row `(id=X, path=Notes/Foo.md, tombstone_at=null)`
- **WHEN** the file is deleted via `DELETE /api/files`
- **THEN** the row becomes `(id=X, path=Notes/Foo.md, tombstone_at=<now>)`

#### Scenario: External delete tombstones
- **WHEN** chokidar emits `unlink` for a path with a known handle
- **THEN** the corresponding row's `tombstone_at` is set
