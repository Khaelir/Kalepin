# related-notes Specification

## Purpose
TBD - created by archiving change add-related-notes. Update Purpose after archive.
## Requirements
### Requirement: Rank notes by mean-vector similarity
The system SHALL represent each note by the L2-normalised mean of its note-chunk embeddings (comment embeddings excluded) and rank related notes by the cosine similarity between the source note's vector and every other note's vector. Only notes scoring at or above the minimum score SHALL be returned, sorted by descending score, capped at the requested limit. The minimum score SHALL default to 0.88 and MAY be overridden with the `RELATED_NOTES_MIN_SCORE` environment variable. The limit SHALL default to 5 and SHALL NOT exceed 20.

#### Scenario: Closest notes come first
- **WHEN** related notes are requested for `Engineering/Deploy.md` and `Engineering/Rollback.md` scores 0.93 while `Recipes/Bread.md` scores 0.91
- **THEN** `Engineering/Rollback.md` is listed before `Recipes/Bread.md`

#### Scenario: Notes below the floor are dropped
- **WHEN** a candidate note's similarity to the source note is below the minimum score
- **THEN** it is not returned, even if fewer than `limit` notes qualify

#### Scenario: Limit defaults and clamps
- **WHEN** no limit is given
- **THEN** at most 5 notes are returned
- **AND WHEN** a limit of 50 is requested
- **THEN** at most 20 notes are returned

#### Scenario: Note without embeddings yet
- **WHEN** the source note has no note-chunk embeddings (e.g. it was just created and has not been embedded)
- **THEN** the response is available with an empty item list

### Requirement: Explain each related note
Each related note SHALL carry its `path`, `title` (file basename without `.md`), `score`, a `linked` flag, and a `reason` derived from the best-matching chunk pair — the pair of one source chunk and one candidate chunk with the highest cosine similarity. The reason SHALL contain the candidate chunk's heading, the source chunk's heading and a short plain-text excerpt of the candidate chunk.

#### Scenario: Reason names the matching section
- **WHEN** the source note's "Rollout" section is the closest match to the candidate's "Deployment" section
- **THEN** the item's reason has `heading` "Deployment", `sourceHeading` "Rollout" and an excerpt taken from the candidate's "Deployment" chunk

#### Scenario: Linked flag reflects either direction
- **WHEN** the source note links to the candidate, or the candidate links to the source note
- **THEN** the item's `linked` is `true`
- **AND WHEN** neither note links to the other
- **THEN** `linked` is `false`

### Requirement: Related notes respect visibility and encryption
The system SHALL only compute related notes for a source note the caller can read, and SHALL apply the same visibility predicate as vector search (shared vault, the caller's own personal folder, and paths granted to the caller) to every candidate before scoring it. The system SHALL never return the source note itself, paths under an end-to-end encrypted `_secure/` folder, attachments, or paths containing a dot-prefixed segment (such as `.trash/`).

#### Scenario: Other users' personal notes never appear
- **GIVEN** Alice's personal note `_users/alice@example.com/Diary.md` is the closest match to a shared note
- **WHEN** Bob requests related notes for that shared note
- **THEN** Alice's note is not in the response

#### Scenario: Own personal notes and granted notes appear
- **WHEN** Alice requests related notes for a shared note
- **THEN** matching notes in her own personal folder and personal notes shared with her by grant can appear

#### Scenario: Unreadable source note
- **WHEN** Bob requests related notes for a path under Alice's personal folder that has not been shared with him
- **THEN** the request fails with 404, identical to a request for a nonexistent path

#### Scenario: Encrypted notes are excluded
- **WHEN** related notes are computed
- **THEN** no path under `_users/{email}/_secure/` is returned

#### Scenario: Trashed notes disappear
- **WHEN** a note is deleted or moved into the `.trash/` folder
- **THEN** it no longer appears in any related-notes response

#### Scenario: PIN-locked source note
- **WHEN** the source note has a PIN and the request carries no valid unlock token
- **THEN** the REST endpoint responds 423 and the MCP tool returns the `pin-protected` sentinel

#### Scenario: PIN-locked candidate
- **WHEN** a related note has a PIN
- **THEN** it is listed with `reason: null`, so no excerpt of its content is returned

### Requirement: Degrade gracefully without the semantic index
When the embedding model is not loaded, or when the source note is end-to-end encrypted, the system SHALL answer `{ available: false, items: [] }` instead of an error.

#### Scenario: Model not loaded
- **WHEN** the embedding model failed to load or is still loading
- **THEN** `GET /api/search/related` responds 200 with `{ "available": false, "items": [] }`

#### Scenario: Encrypted source note
- **WHEN** related notes are requested for `_users/alice@example.com/_secure/journal.md` by Alice
- **THEN** the response is `{ "available": false, "items": [] }`

### Requirement: Mean vectors are cached and invalidated on embedding changes
The system SHALL cache per-note mean vectors in memory so that a request is a single pass over notes, and SHALL invalidate a note's cached vector whenever its embeddings are written or removed (including deletion, rename, move into `.trash/`, and the end-to-end-encryption purge), and all cached vectors when the index is rebuilt.

#### Scenario: Edited note is re-ranked
- **WHEN** a note's content changes and its embeddings are rewritten
- **THEN** the next related-notes request uses the note's new mean vector

#### Scenario: Deleted note is evicted
- **WHEN** a note's embeddings are removed
- **THEN** its cached mean vector is dropped and it is no longer a candidate

#### Scenario: Full reindex
- **WHEN** the search index is rebuilt with `reindexAll`
- **THEN** all cached mean vectors and the in-memory chunk cache are discarded

### Requirement: REST endpoint for related notes
The system SHALL expose `GET /api/search/related?path=<path>&limit=<n>`, requiring the `notes:search` permission, returning `{ available: boolean, items: RelatedNote[] }`.

#### Scenario: Missing path
- **WHEN** the endpoint is called without `path`
- **THEN** it responds 400

#### Scenario: Successful request
- **WHEN** an authenticated user with `notes:search` requests related notes for a readable note
- **THEN** the response is `{ "available": true, "items": [...] }` with each item carrying `path`, `title`, `score`, `linked` and `reason`

### Requirement: MCP related_notes tool
The MCP server SHALL register a read tool `related_notes` for every API key scope. It SHALL accept a note `path` or stable `id` (id wins, as in the other note tools) and an optional `limit`, and SHALL return a JSON array of `{ path, id, title, score, linked, reason }` computed with the same ranking and gates as the REST endpoint.

#### Scenario: Lookup by id
- **WHEN** an agent calls `related_notes` with the stable id of a readable note
- **THEN** the tool returns the related notes of that note, each with its own stable `id`

#### Scenario: Read-only key
- **WHEN** an MCP session is initialised with a read-only key
- **THEN** `related_notes` is registered alongside the other read tools

#### Scenario: Semantic index unavailable
- **WHEN** the embedding model is not loaded
- **THEN** the tool returns a text message saying related notes are unavailable, not an error

