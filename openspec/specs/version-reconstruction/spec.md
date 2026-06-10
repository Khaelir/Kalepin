# version-reconstruction Specification

## Purpose
TBD - created by archiving change version-history. Update Purpose after archive.
## Requirements
### Requirement: Query change history for a note
The system SHALL provide an API endpoint to retrieve the ordered list of changes for a specific note path, including change ID, action, user attribution, and timestamp.

#### Scenario: Retrieve history for a note with multiple edits
- **WHEN** a client sends `GET /api/files/history?path=notes/meeting.md`
- **THEN** the system returns a JSON array of change entries ordered by `createdAt` descending, each containing `id`, `action`, `userId`, `userEmail`, and `createdAt`

#### Scenario: Retrieve history for a note with no changes
- **WHEN** a client sends `GET /api/files/history?path=notes/new.md` and no changes exist for that path
- **THEN** the system returns an empty array

#### Scenario: History respects retention policy
- **WHEN** changes older than `VERSION_HISTORY_RETENTION_DAYS` exist for a note
- **THEN** those changes are excluded from the history response

### Requirement: Reconstruct document at a historical point
The system SHALL reconstruct the full document content as it existed at any recorded change by replaying diffs from the nearest snapshot forward.

#### Scenario: Reconstruct a version with a snapshot available
- **WHEN** a client sends `GET /api/files/version?path=notes/meeting.md&changeId=42`
- **AND** a snapshot exists at or before change 42
- **THEN** the system returns the reconstructed markdown content as it was after change 42 was applied

#### Scenario: Reconstruct a version from initial creation
- **WHEN** a client sends `GET /api/files/version?path=notes/meeting.md&changeId=5`
- **AND** no snapshot exists before change 5, but a `created` action with diff exists
- **THEN** the system reconstructs content by applying diffs starting from the empty document at creation

#### Scenario: Reconstruction fails due to corrupted chain
- **WHEN** diff replay fails (e.g., a diff cannot be applied to the intermediate content)
- **THEN** the system returns the nearest available snapshot content with a warning flag indicating partial reconstruction

### Requirement: Periodic snapshot storage
The system SHALL store full-content snapshots at configurable intervals to bound reconstruction cost.

#### Scenario: Snapshot created after N changes
- **WHEN** a change is recorded for a note and the number of changes since the last snapshot equals or exceeds the snapshot interval (default: 20)
- **THEN** the system stores a full-content snapshot associated with that change ID and path

#### Scenario: Snapshot created on note creation
- **WHEN** a note is created (action = `created`)
- **THEN** the system stores a snapshot with the initial content

### Requirement: Separate retention for version history
The system SHALL retain `note_changes` and `note_snapshots` records for a configurable duration independent of the "What's Changed" feed pruning.

#### Scenario: Default retention period
- **WHEN** `VERSION_HISTORY_RETENTION_DAYS` is not configured
- **THEN** version history data is retained for 365 days

#### Scenario: Custom retention period
- **WHEN** `VERSION_HISTORY_RETENTION_DAYS` is set to 180
- **THEN** changes and snapshots older than 180 days are pruned

#### Scenario: Feed pruning does not affect version history
- **WHEN** the "What's Changed" feed prune job runs with a 90-day cutoff
- **THEN** `note_changes` records younger than `VERSION_HISTORY_RETENTION_DAYS` are NOT deleted

### Requirement: Restore a historical version
The system SHALL allow restoring a note to a historical version by submitting the reconstructed content as a new edit through the OT system.

#### Scenario: Restore a past version while no one else is editing
- **WHEN** a client sends `POST /api/files/restore` with `path` and `changeId`
- **THEN** the system reconstructs the historical content and applies it as an OT operation, replacing the current document content
- **AND** a new `modified` change is recorded in `note_changes` with the restore diff

#### Scenario: Restore while another user is actively editing
- **WHEN** a restore is submitted and another user has an active OT session on the same document
- **THEN** the restore content is applied through OT, and the other user sees the change in real-time via their WebSocket connection

#### Scenario: Restore of a version that cannot be reconstructed
- **WHEN** a client sends a restore request and reconstruction fails
- **THEN** the system returns a 422 error with a message explaining the reconstruction failure

