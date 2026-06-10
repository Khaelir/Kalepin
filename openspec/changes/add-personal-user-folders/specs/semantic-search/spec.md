## MODIFIED Requirements

### Requirement: Vector cosine search filters candidate chunks by viewer visibility

The semantic search code path SHALL skip every embedding chunk whose virtual path is not visible to the viewer before computing similarity. The viewer's email SHALL be passed into the search call from the controller.

#### Scenario: Foreign personal chunks excluded from cosine candidates
- **WHEN** Alice has a personal note whose embeddings are loaded into the global vector cache, and Bob issues a semantic search query that would otherwise return one of Alice's chunks among top-K
- **THEN** Bob's response excludes those chunks; the top-K is computed from the visible candidate set only

#### Scenario: Owner sees own personal chunks
- **WHEN** Alice issues a semantic search query whose top-K includes her own personal chunks
- **THEN** her response contains those chunks

### Requirement: Vector cache is owner-blind; predicate runs in the cosine loop

The system SHALL continue to load embeddings for personal notes into the same in-memory vector cache as shared notes. The visibility predicate SHALL run inside the per-query cosine loop, not at cache load time.

#### Scenario: Cache load includes personal notes
- **WHEN** the vector cache is initialized
- **THEN** it contains chunks for every indexed note, including personal notes belonging to all users

#### Scenario: Cache invalidation on personal note delete
- **WHEN** a personal note is deleted
- **THEN** its chunks are removed from the cache by the same code path that handles shared-note deletion
