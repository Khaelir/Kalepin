# Spec delta: full-text-search (MODIFIED)

## MODIFIED Requirements

### Requirement: FTS indexing skips E2E paths

The `shouldIndexPlaintext` predicate SHALL return false for `isE2EEncrypted` paths. The notes_fts and comments_fts indexers SHALL skip these paths; queries SHALL not return rows for them.

#### Scenario: E2E note is not in FTS
- **GIVEN** Alice creates `_users/alice/_secure/journal.md` with content "ginger"
- **WHEN** Alice searches for "ginger"
- **THEN** the result list does NOT include the E2E note (the server has no plaintext to index)
