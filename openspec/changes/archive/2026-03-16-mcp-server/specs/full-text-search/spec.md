## ADDED Requirements

### Requirement: Full-text search across notes
The system SHALL provide full-text search across all markdown notes using SQLite FTS5 with BM25 ranking. Search results SHALL include the file path, a matching snippet, and a relevance score.

#### Scenario: Search by keyword
- **WHEN** a user searches for "LwM2M object"
- **THEN** the system returns all notes containing those terms, ranked by BM25 relevance score, with matching snippets highlighted

#### Scenario: Search with no results
- **WHEN** a user searches for a term that appears in no notes
- **THEN** the system returns an empty result set

#### Scenario: Partial word matching
- **WHEN** a user searches for "deploy"
- **THEN** the system matches notes containing "deploy", "deployment", "deployed" (prefix matching)

### Requirement: Search REST endpoint
The system SHALL expose a `GET /api/files/search` endpoint that accepts a `q` query parameter and returns ranked search results.

#### Scenario: Search via API
- **WHEN** a client sends `GET /api/files/search?q=device+model`
- **THEN** the system returns a JSON array of `{ path, snippet, score }` objects sorted by descending score

#### Scenario: Empty query
- **WHEN** a client sends `GET /api/files/search` without a `q` parameter
- **THEN** the system returns a 400 Bad Request error

### Requirement: Automatic index updates
The system SHALL keep the FTS5 index in sync with note content by indexing on file create, update, and delete events.

#### Scenario: New note indexed
- **WHEN** a user creates a new note at path "projects/design.md" with content "System architecture overview"
- **THEN** the note becomes searchable by "architecture" immediately after creation

#### Scenario: Updated note re-indexed
- **WHEN** a user updates a note to add the text "migration strategy"
- **THEN** searching for "migration strategy" returns that note

#### Scenario: Deleted note removed from index
- **WHEN** a user deletes a note
- **THEN** that note no longer appears in search results

#### Scenario: External file change detected
- **WHEN** a file is modified outside the app and the file watcher detects the change
- **THEN** the FTS5 index is updated to reflect the new content

### Requirement: Manual re-index endpoint
The system SHALL expose a `POST /api/search/reindex` endpoint that rebuilds the entire FTS5 index from the current file tree.

#### Scenario: Full re-index
- **WHEN** an admin calls `POST /api/search/reindex`
- **THEN** the system scans all markdown files, drops and rebuilds the FTS5 index, and returns the count of indexed documents
