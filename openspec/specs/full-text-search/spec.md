## Purpose

Full-text search across notes via SQLite FTS5 with ranked results.
## Requirements
### Requirement: Full-text search across notes
The system SHALL provide full-text search across all markdown notes using SQLite FTS5 with BM25 ranking. Search results SHALL include the file path, a matching snippet, and a relevance score. BM25 SHALL weight title matches 10x and path matches 5x relative to content matches.

#### Scenario: Search by keyword
- **WHEN** a user searches for "LwM2M object"
- **THEN** the system returns all notes containing those terms, ranked by BM25 relevance score with column weights (title > path > content), with matching snippets highlighted

#### Scenario: Search with no results
- **WHEN** a user searches for a term that appears in no notes
- **THEN** the system returns an empty result set

#### Scenario: Partial word matching
- **WHEN** a user searches for "deploy"
- **THEN** the system matches notes containing "deploy", "deployment", "deployed" (prefix matching)

#### Scenario: Title match ranks higher than body match
- **WHEN** a user searches for "kubernetes" and one note has "kubernetes" in its title while another has "kubernetes" mentioned once in its body
- **THEN** the title-matching note ranks higher

#### Scenario: Path match ranks higher than body match
- **WHEN** a user searches for "recipes" and one note lives at "recipes/pasta.md" while another mentions "recipes" in its body
- **THEN** the path-matching note ranks higher (but lower than a hypothetical title match)

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

### Requirement: AND-default query mode with OR fallback
The system SHALL default to AND-mode for multi-word FTS5 queries. If the AND query returns fewer than 3 results, the system SHALL fall back to OR-mode.

#### Scenario: Multi-word AND query with sufficient results
- **WHEN** a user searches for "react hooks"
- **THEN** the system runs `"react"* AND "hooks"*` and returns results containing both terms

#### Scenario: Multi-word AND query with insufficient results falls back to OR
- **WHEN** a user searches for "kubernetes istio" and fewer than 3 notes contain both terms
- **THEN** the system falls back to `"kubernetes"* OR "istio"*` and returns results containing either term

#### Scenario: Single-word query is unaffected
- **WHEN** a user searches for "deploy"
- **THEN** the system runs `"deploy"*` (AND and OR are equivalent for single terms)

### Requirement: Quoted phrase matching
The system SHALL detect quoted substrings in the user's query and pass them to FTS5 as phrase queries. Non-quoted terms SHALL remain prefix-matched.

#### Scenario: Exact phrase search
- **WHEN** a user searches for `"error handling" react`
- **THEN** the system matches notes containing the exact phrase "error handling" AND the prefix "react"*

#### Scenario: Phrase with no matches
- **WHEN** a user searches for `"xyzzy quantum"` and no note contains that exact phrase
- **THEN** the system returns an empty result set (or falls back to OR if AND yields < 3)

#### Scenario: Query without quotes behaves normally
- **WHEN** a user searches for `error handling react` (no quotes)
- **THEN** the system uses standard AND-mode prefix matching, not phrase matching

### Requirement: Search results include grant-visible foreign personal paths

The FTS5 search predicate SHALL be extended so a result is returned when the requester is the owner OR has an active grant on the path. The query SHALL NOT leak foreign personal paths the requester has no relationship with.

#### Scenario: Bob's search hits Alice's shared note
- **GIVEN** Alice has an active read grant for Bob on `_users/alice/foo.md` containing the word "kelp"
- **WHEN** Bob searches for "kelp"
- **THEN** the result list includes `_users/alice/foo.md`

#### Scenario: Bob's search does NOT hit Alice's other notes
- **GIVEN** Alice has an active grant on `foo.md` only
- **AND** Alice has another note `bar.md` also containing "kelp" with no grant
- **WHEN** Bob searches for "kelp"
- **THEN** the result list does NOT include `_users/alice/bar.md`

### Requirement: Tag filter tokens in search queries

The search query parser SHALL recognise `tag:<name>` tokens (case-insensitive prefix, optional leading `#` on the name, outside double quotes). Each token SHALL restrict results to notes carrying `<name>` or any `<name>/…` child tag; several tokens SHALL be combined with AND. The remaining text SHALL be searched with the usual hybrid pipeline, restricted to the tagged notes before ranking. A query made only of `tag:` tokens SHALL return the tagged notes visible to the caller, most recently modified first, each with a body excerpt as `snippet` and a `modifiedAt` timestamp. The REST search endpoint and the MCP `search_notes` tool SHALL share this parsing.

#### Scenario: Tag-only query
- **GIVEN** visible notes A (tagged `meeting`, modified yesterday) and B (tagged `meeting/weekly`, modified today), and C (untagged)
- **WHEN** a client sends `GET /api/files/search?q=tag:meeting`
- **THEN** the response lists B then A, each with `modifiedAt`, and not C

#### Scenario: Tag plus text
- **GIVEN** notes A (`#meeting`, body "budget review") and B (untagged, body "budget review")
- **WHEN** a client searches for `tag:meeting budget`
- **THEN** A is returned and B is not

#### Scenario: Multiple tags are ANDed
- **GIVEN** note A tagged `x` and `y`, and note B tagged `x` only
- **WHEN** a client searches for `tag:x tag:y`
- **THEN** only A is returned

#### Scenario: Quoted token is text
- **WHEN** a client searches for `"tag:x"`
- **THEN** no tag filter is applied and the phrase is searched as text

#### Scenario: Tag filter respects visibility
- **GIVEN** Alice's personal note is tagged `plan`
- **WHEN** Bob searches for `tag:plan`
- **THEN** Alice's note is not returned

