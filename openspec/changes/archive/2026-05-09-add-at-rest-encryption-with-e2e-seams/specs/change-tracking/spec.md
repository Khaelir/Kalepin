# Spec delta: change-tracking (MODIFIED)

## ADDED Requirements

### Requirement: Metadata-only diff mode for predicate-skipped paths

The `note_changes` table SHALL include columns `metadata_only INTEGER NOT NULL DEFAULT 0`, `old_hash TEXT`, `new_hash TEXT`, `op_type TEXT`. When `shouldIndexPlaintext(path)` returns false, the change-tracking service SHALL store only metadata for that path: SHA-256 of old and new content, sizes, op classification, author, timestamp — and NULL `diff_text` with `metadata_only = 1`.

#### Scenario: Stage 1 stores full diffs
- **GIVEN** stage 1 default predicates (true everywhere)
- **WHEN** a note is edited
- **THEN** the change row has `metadata_only = 0` and a non-null `diff_text`

#### Scenario: Stage-2 contract test
- **GIVEN** the predicate is stubbed to return false for path `P`
- **WHEN** content at `P` is edited
- **THEN** the change row has `metadata_only = 1`, non-null `old_hash`, `new_hash`, `op_type`, and NULL `diff_text`

### Requirement: Updates feed and changes UI handle metadata-only rows

The frontend changes feed SHALL render rows where `metadata_only = 1` with the diff replaced by `(content hidden)` and the path still visible to the requester per existing visibility rules.

#### Scenario: UI shows hidden-content sentinel
- **GIVEN** a metadata-only row exists in the changes feed for the requester
- **WHEN** the user opens the changes panel
- **THEN** the row displays the path, author, timestamp, and `(content hidden)` instead of a diff
