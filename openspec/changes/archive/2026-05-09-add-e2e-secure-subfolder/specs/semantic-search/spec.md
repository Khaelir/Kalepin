# Spec delta: semantic-search (MODIFIED)

## MODIFIED Requirements

### Requirement: Embeddings skip E2E paths

The semantic-search indexer SHALL skip `isE2EEncrypted` paths. No vectors SHALL exist for them; cosine queries SHALL not surface them.

#### Scenario: E2E note is not in vector index
- **GIVEN** Alice creates `_users/alice/_secure/foo.md` with content semantically related to a query
- **WHEN** Alice runs that semantic query
- **THEN** the result list does NOT include the E2E note
