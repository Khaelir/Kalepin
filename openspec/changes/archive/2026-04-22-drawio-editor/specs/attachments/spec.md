## ADDED Requirements

### Requirement: Attachment save-back for draw.io SVGs
The attachment system SHALL support updating an existing attachment's content and updating the referencing note's markdown.

#### Scenario: draw.io editor saves updated SVG
- **WHEN** the draw.io editor sends an updated SVG via the save flow
- **THEN** the backend writes the new SVG content to `_attachments/` with a new content-addressed filename
- **THEN** the backend (or frontend) updates the note's markdown to replace the old image reference with the new filename
- **THEN** the operation is atomic — no intermediate state where the reference points to a non-existent file

#### Scenario: SVG content unchanged on save
- **WHEN** the SVG content hash matches the existing file
- **THEN** no new file is written
- **THEN** no markdown reference update is needed

#### Scenario: Old SVG file cleanup
- **WHEN** a draw.io save produces a new file and updates the reference
- **THEN** the old SVG file becomes orphaned
- **THEN** the existing orphan cleanup mechanism handles deletion (moved to `.trash/`, purged after 7 days)
