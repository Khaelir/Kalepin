## ADDED Requirements

### Requirement: Note changes are persisted on every save
The system SHALL record a row in the `note_changes` table each time a note is created, modified, or deleted. The row SHALL contain the file path, action type, a unified diff (for creates and modifications), and a timestamp.

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

### Requirement: OT diff capture has zero extra disk I/O
The system SHALL compute diffs on the OT flush path using only in-memory data (`lastFlushedContent` vs `session.content`). The system SHALL NOT perform additional file reads on the OT path for diff computation.

#### Scenario: OT flush does not read from disk for diff
- **WHEN** the OT session manager flushes a document
- **THEN** the diff is computed from the in-memory `lastFlushedContent` and `session.content` without any filesystem read

### Requirement: DB insert does not block the write path
The system SHALL insert `note_changes` rows asynchronously on the OT flush path. A failed insert SHALL NOT prevent the file from being written to disk.

#### Scenario: DB insert failure does not block flush
- **WHEN** the `note_changes` insert fails (e.g., DB locked)
- **THEN** the file is still written to disk successfully and an error is logged

### Requirement: Old changes are pruned automatically
The system SHALL delete rows from `note_changes` where `created_at` is older than the minimum `last_active_at` across all users. The system SHALL retain changes for a maximum of 90 days regardless of user activity. Pruning SHALL run on application startup.

#### Scenario: Pruning after all users have checked
- **WHEN** all users have `last_active_at` more recent than a change row's `created_at`
- **THEN** that row is deleted during the next pruning cycle

#### Scenario: Hard cap at 90 days
- **WHEN** a change row is older than 90 days
- **THEN** it is deleted during pruning regardless of any user's `last_active_at`
