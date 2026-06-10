## MODIFIED Requirements

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

## ADDED Requirements

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
