# Spec delta: semantic-search (MODIFIED)

## MODIFIED Requirements

### Requirement: Embedding generation consults `shouldIndexPlaintext`

The system SHALL gate every chunk-embedding call by `shouldIndexPlaintext(path)`. When the predicate returns false, the path SHALL be skipped during embedding generation and its vectors excluded from cosine search.

#### Scenario: Stage-2 contract test
- **GIVEN** the predicate is stubbed to return false for path `P`
- **WHEN** content at `P` is created or updated
- **THEN** no embedding row for `P` exists; semantic queries that would otherwise rank `P` return zero results for `P`
