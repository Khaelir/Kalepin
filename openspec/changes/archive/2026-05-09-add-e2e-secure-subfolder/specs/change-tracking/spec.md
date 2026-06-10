# Spec delta: change-tracking (MODIFIED)

## MODIFIED Requirements

### Requirement: Change rows for E2E paths are metadata-only

For `isE2EEncrypted` paths, change-tracking SHALL persist `metadata_only = 1` rows: SHA-256 of old/new content, sizes, op classification, author, timestamp. The `diff_text` column SHALL be NULL.

#### Scenario: E2E edit logs metadata only
- **GIVEN** Alice edits `_users/alice/_secure/journal.md`
- **WHEN** the change is recorded
- **THEN** the new row has `metadata_only = 1`, non-null `old_hash` and `new_hash`, and `diff_text = NULL`

#### Scenario: UI hides content for E2E rows
- **WHEN** Alice opens the changes feed and a metadata-only row is rendered
- **THEN** the diff column shows "(content hidden)" with the path, author, and timestamp visible
