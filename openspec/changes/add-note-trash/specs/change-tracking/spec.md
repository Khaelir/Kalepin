## MODIFIED Requirements

### Requirement: Note changes are persisted on every save
The system SHALL record a row in the `note_changes` table each time a note is created, modified, or deleted. The row SHALL contain the file path, action type, a unified diff (for creates and modifications), and a timestamp. Deleting a folder SHALL record one `deleted` row per note it contains. Restoring a note from the trash SHALL record a `created` row with its full content. Notes deleted on disk by another program SHALL record a `deleted` row.

#### Scenario: OT flush persists a diff
- **WHEN** the OT session manager flushes a dirty document to disk
- **THEN** the system computes a unified diff between `lastFlushedContent` and the current content, inserts a row with `action='modified'` and the diff into `note_changes`, and updates `lastFlushedContent`

#### Scenario: Non-OT edit persists a diff
- **WHEN** a note is updated via the API or MCP (not through OT)
- **THEN** the system reads the current file content before writing, computes a unified diff, and inserts a row with `action='modified'` and the diff into `note_changes`

#### Scenario: Note creation persists full content
- **WHEN** a new note is created (via any path)
- **THEN** the system inserts a row with `action='created'` and the full content as the diff into `note_changes`

#### Scenario: Note deletion persists a record
- **WHEN** a note is deleted (via any path)
- **THEN** the system inserts a row with `action='deleted'` and `diff=NULL` into `note_changes`

#### Scenario: Folder deletion records each note
- **WHEN** a folder containing `a.md` and `sub/b.md` is moved to the trash
- **THEN** the system inserts one `deleted` row for `a.md` and one for `sub/b.md`

#### Scenario: Restore continues the history
- **WHEN** a note is restored from the trash
- **THEN** the system inserts a row with `action='created'` and the restored content at the restored path

#### Scenario: External delete is recorded once
- **WHEN** another program deletes `notes/x.md` from disk and no `add` pairs it into a rename
- **THEN** the system inserts one `deleted` row for `notes/x.md` with no user
- **AND** removals Kalepin caused itself do not produce an extra row
