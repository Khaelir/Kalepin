## ADDED Requirements

### Requirement: Auto-snapshot current content before restore
Before applying a restored historical version, the system SHALL create a snapshot of the current document content so the pre-restore state is preserved in version history.

#### Scenario: Restore creates a pre-restore snapshot
- **WHEN** a user triggers a restore of a historical version via `POST /api/files/restore`
- **THEN** the system reads the current file content, creates a `note_changes` row and a `note_snapshots` row for the current state, and then applies the restored content

#### Scenario: Pre-restore state appears in history
- **WHEN** a restore has been performed
- **THEN** the version history timeline shows the pre-restore state as an entry that the user can select and preview
- **AND** the user can restore to the pre-restore state using the same restore flow

#### Scenario: Restore of content identical to current
- **WHEN** a user restores a version whose content is identical to the current document
- **THEN** no changes are applied and no new history entries are created
