# Spec delta: full-text-search (MODIFIED)

## MODIFIED Requirements

### Requirement: FTS5 indexing consults `shouldIndexPlaintext`

The system SHALL gate every notes_fts and comments_fts indexing call by `shouldIndexPlaintext(path)`. When the predicate returns false, the path SHALL be skipped during indexing and its rows excluded from query results. In stage 1 the predicate is true everywhere; in stage 2 it returns false for `isE2EEncrypted` paths.

#### Scenario: Stage 1 indexing is unchanged
- **GIVEN** stage 1 default predicates
- **WHEN** a personal note (encrypted on disk) is created
- **THEN** the FTS5 index contains its plaintext content (because the storage adapter decrypted on read)

#### Scenario: Stage-2 contract test
- **GIVEN** the predicate is stubbed to return false for path `P`
- **WHEN** content at `P` is created or updated
- **THEN** no FTS5 row for `P` exists; queries that would otherwise match return zero hits for `P`
