## Purpose

Updates starred-item and change-history paths when files or folders are renamed or moved on disk, so downstream state follows the rename rather than treating it as a delete + create.

## Requirements

### Requirement: File rename detection via chokidar debounce
The system SHALL correlate a chokidar `unlink` event followed by an `add` event within a 300ms debounce window as a rename when the two files have matching content, and SHALL NOT treat the pair as a delete + create.

#### Scenario: Matching content within debounce window
- **WHEN** chokidar emits `unlink` on `a.md` and, within 300ms, `add` on `b.md` whose byte-for-byte content matches the previous `a.md`
- **THEN** the system SHALL classify the pair as a rename from `a.md` to `b.md`

#### Scenario: No matching add within window
- **WHEN** chokidar emits `unlink` on `a.md` and no matching `add` arrives within 300ms
- **THEN** the system SHALL treat the event as a genuine delete and SHALL NOT update any paths

#### Scenario: Multiple matching adds
- **WHEN** multiple `add` events arrive within the debounce window whose size and first 1KB match the deleted file
- **THEN** the system SHALL prefer the one with an identical byte-for-byte content match

### Requirement: Path updates on rename
On a detected rename, the system SHALL update rows whose `path` equals the old path in `starred_items` and `note_changes` to the new path.

#### Scenario: Starred file renamed
- **WHEN** a rename from `notes/a.md` to `notes/b.md` is detected and a row exists in `starred_items` with `path = 'notes/a.md'`
- **THEN** that row's `path` SHALL be updated to `'notes/b.md'`

#### Scenario: Change history for renamed file
- **WHEN** a rename from `notes/a.md` to `notes/b.md` is detected and rows exist in `note_changes` with `path = 'notes/a.md'`
- **THEN** those rows' `path` SHALL be updated to `'notes/b.md'`

### Requirement: Folder rename propagates to children
When a folder is renamed, the system SHALL update every `starred_items` and `note_changes` row whose path begins with the old folder prefix, rewriting the prefix to the new folder path.

#### Scenario: Folder rename rewrites descendant paths
- **WHEN** folder `projects/` is renamed to `archive/projects/` and rows exist with paths like `projects/a.md` and `projects/sub/b.md`
- **THEN** those rows SHALL be rewritten to `archive/projects/a.md` and `archive/projects/sub/b.md`

### Requirement: Rename correlation is a storage-adapter responsibility
Storage adapters (e.g. `LocalFSAdapter`, `GitAdapter`) SHALL invoke a shared rename-correlation utility from their chokidar pipeline, and the utility SHALL delegate path updates to a service layer rather than issuing database writes directly.

#### Scenario: Adapter delegates DB writes
- **WHEN** the correlation utility identifies a rename
- **THEN** it SHALL call the rename-path service to perform the `starred_items` and `note_changes` updates
- **AND** it SHALL NOT issue SQL directly from the adapter
