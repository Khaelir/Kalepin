## MODIFIED Requirements

### Requirement: Orphan detection by scanning documents
The system SHALL provide an endpoint `POST /api/files/attachments/cleanup` that scans all `.md` files in the vault for image references to `_attachments/`, compares against actual files in `_attachments/`, and identifies unreferenced files as orphans. Notes in a trash folder (`.trash/`) SHALL be scanned like any other note, so a note that can still be restored keeps its attachments.

#### Scenario: Detect orphaned attachment
- **WHEN** cleanup is triggered and `_attachments/abc123.png` is not referenced by any `.md` file in the vault
- **THEN** the system identifies `abc123.png` as an orphan

#### Scenario: Referenced attachment is kept
- **WHEN** cleanup is triggered and `_attachments/def456.png` is referenced by `notes/doc.md`
- **THEN** the system does NOT identify `def456.png` as an orphan

#### Scenario: Attachment referenced by a trashed note is kept
- **WHEN** cleanup is triggered and `_attachments/ghi789.png` is referenced only by `.trash/<id>/doc.md`
- **THEN** the system does NOT identify `ghi789.png` as an orphan

#### Scenario: No attachments directory exists
- **WHEN** cleanup is triggered and `_attachments/` does not exist
- **THEN** the system returns successfully with zero orphans found
