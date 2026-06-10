## ADDED Requirements

### Requirement: Orphan detection by scanning documents
The system SHALL provide an endpoint `POST /api/files/attachments/cleanup` that scans all `.md` files in the vault for image references to `_attachments/`, compares against actual files in `_attachments/`, and identifies unreferenced files as orphans.

#### Scenario: Detect orphaned attachment
- **WHEN** cleanup is triggered and `_attachments/abc123.png` is not referenced by any `.md` file in the vault
- **THEN** the system identifies `abc123.png` as an orphan

#### Scenario: Referenced attachment is kept
- **WHEN** cleanup is triggered and `_attachments/def456.png` is referenced by `notes/doc.md`
- **THEN** the system does NOT identify `def456.png` as an orphan

#### Scenario: No attachments directory exists
- **WHEN** cleanup is triggered and `_attachments/` does not exist
- **THEN** the system returns successfully with zero orphans found

### Requirement: Soft-delete orphans to trash
The system SHALL move orphaned attachments to `_attachments/.trash/` rather than permanently deleting them. Each trashed file SHALL be prefixed with an ISO-8601 timestamp (e.g., `2026-03-11T14:30:00Z_abc123.png`).

#### Scenario: Orphan moved to trash
- **WHEN** `abc123.png` is identified as an orphan during cleanup
- **THEN** it is moved to `_attachments/.trash/{ISO-timestamp}_abc123.png`

#### Scenario: Trash directory auto-created
- **WHEN** orphans are found and `_attachments/.trash/` does not exist
- **THEN** the system creates the directory before moving files

### Requirement: Purge trash entries older than 7 days
During cleanup, the system SHALL permanently delete any file in `_attachments/.trash/` whose timestamp prefix indicates it was trashed more than 7 days ago.

#### Scenario: Old trash entry purged
- **WHEN** cleanup runs and `_attachments/.trash/2026-03-01T10:00:00Z_abc123.png` exists and today is 2026-03-11
- **THEN** the file is permanently deleted (10 days old > 7 day threshold)

#### Scenario: Recent trash entry preserved
- **WHEN** cleanup runs and `_attachments/.trash/2026-03-10T10:00:00Z_def456.png` exists and today is 2026-03-11
- **THEN** the file is NOT deleted (1 day old < 7 day threshold)

### Requirement: Cleanup returns summary
The cleanup endpoint SHALL return a summary of actions taken, including the number of orphans found, files moved to trash, and files permanently purged from trash.

#### Scenario: Cleanup with mixed results
- **WHEN** cleanup finds 3 orphans and 2 expired trash entries
- **THEN** it returns `{ orphansFound: 3, movedToTrash: 3, purgedFromTrash: 2 }`

#### Scenario: Cleanup with nothing to do
- **WHEN** cleanup finds no orphans and no expired trash entries
- **THEN** it returns `{ orphansFound: 0, movedToTrash: 0, purgedFromTrash: 0 }`
