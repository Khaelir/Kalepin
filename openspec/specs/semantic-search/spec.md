## Purpose

Hybrid full-text + vector search over notes using local ONNX embeddings for semantic ranking.

## Requirements

### Requirement: Embed notes using local ONNX model
The system SHALL generate vector embeddings for all markdown notes using the all-MiniLM-L6-v2 model running locally via ONNX Runtime. Embeddings SHALL be 384-dimensional Float32 vectors.

#### Scenario: Note is embedded on creation
- **WHEN** a new markdown file is added to the vault
- **THEN** the system generates embeddings for each chunk of the note and stores them in the database

#### Scenario: Note is re-embedded on change
- **WHEN** an existing markdown file is modified
- **THEN** the system removes old embeddings for that path and generates new embeddings for the updated content

#### Scenario: Embeddings are removed on deletion
- **WHEN** a markdown file is deleted from the vault
- **THEN** the system removes all embeddings associated with that file path

### Requirement: Chunk notes by heading boundaries
The system SHALL split markdown notes into chunks at heading boundaries (any `#` level). Each chunk SHALL include its heading as a prefix for context. The first chunk SHALL be prefixed with a humanized version of the file path. Fenced code blocks SHALL be treated as atomic units and never split across chunks.

#### Scenario: Note with multiple headings
- **WHEN** a note contains multiple headings
- **THEN** each heading section becomes a separate chunk with its heading text preserved

#### Scenario: Long section exceeds chunk limit
- **WHEN** a heading section exceeds approximately 1200 characters
- **THEN** the system splits it on paragraph boundaries (double newline) with approximately 200 characters of overlap between chunks, but never splits inside a fenced code block

#### Scenario: Short note without headings
- **WHEN** a note has no headings or is shorter than 1200 characters total
- **THEN** the entire note content becomes a single chunk

#### Scenario: First chunk includes file path context
- **WHEN** a note at path "projects/api-redesign.md" is chunked
- **THEN** the first chunk's text is prefixed with "projects api redesign — " before embedding (but chunk_text stored in DB remains unmodified)

#### Scenario: Code block preserved as atomic unit
- **WHEN** a heading section contains a fenced code block (``` delimiters) that would cause the chunk to exceed 1200 characters
- **THEN** the code block is kept intact in a single chunk rather than being split across chunks

#### Scenario: Multiple code blocks in one section
- **WHEN** a heading section contains prose, then a code block, then more prose, and the total exceeds 1200 characters
- **THEN** the system MAY split between the code block and surrounding prose, but SHALL NOT split within any code block

### Requirement: Store embeddings in SQLite
The system SHALL store embeddings in a `note_embeddings` table with columns: `path` (TEXT), `chunk_idx` (INTEGER), `chunk_text` (TEXT), `heading` (TEXT), and `embedding` (BLOB as Float32Array).

#### Scenario: Embeddings persist across restarts
- **WHEN** the server restarts
- **THEN** previously computed embeddings are available without re-computation

#### Scenario: Upsert on re-index
- **WHEN** a note is re-indexed
- **THEN** all existing embedding rows for that path are deleted before inserting new ones

### Requirement: Hybrid search with Reciprocal Rank Fusion
The `search()` method SHALL run both FTS5 and vector similarity searches, then merge results using Reciprocal Rank Fusion with K=20 and vector weight=1.5x. A light recency boost SHALL be applied after RRF scoring to favor recently modified notes.

#### Scenario: Query matches both keyword and semantic results
- **WHEN** a search query has both exact keyword matches and semantically similar notes
- **THEN** both appear in results, ranked by combined RRF score with recency boost

#### Scenario: Query has only semantic matches
- **WHEN** a search query uses different wording than any note (no FTS5 matches)
- **THEN** semantically similar notes are still returned from vector search

#### Scenario: Query has only keyword matches
- **WHEN** a search query matches notes by exact keywords but no notes are semantically close
- **THEN** FTS5 results are returned (vector results contribute zero or low RRF score)

#### Scenario: Results are deduplicated by path
- **WHEN** the same note appears in both FTS5 and vector results
- **THEN** it appears once in the final results with a combined RRF score

#### Scenario: Recently modified note wins a tie
- **WHEN** two notes have identical RRF scores but one was modified today and the other 6 months ago
- **THEN** the recently modified note ranks higher due to the recency boost (~10% vs ~2%)

### Requirement: Full reindex includes embeddings
The `/api/search/reindex` endpoint SHALL reindex both FTS5 and embeddings for all notes.

#### Scenario: Full reindex regenerates all embeddings
- **WHEN** a full reindex is triggered
- **THEN** all existing embeddings are cleared and regenerated for every markdown file

### Requirement: Model loads on startup
The system SHALL load the ONNX model into memory during module initialization and keep it loaded for the process lifetime.

#### Scenario: Model is ready before first search
- **WHEN** the module finishes initialization
- **THEN** the ONNX model is loaded and ready to generate embeddings

#### Scenario: FTS5 search works during embedding indexing
- **WHEN** the system is still generating embeddings for existing notes (first run or reindex)
- **THEN** FTS5 search remains functional and returns keyword-based results

### Requirement: Minimum query length for vector search
The system SHALL skip vector search for queries shorter than 3 characters and return FTS-only results. Short queries produce near-meaningless embeddings; FTS prefix matching is more effective for these.

#### Scenario: Single character query
- **WHEN** a user searches for "k"
- **THEN** the system returns FTS-only results without invoking the embedding model

#### Scenario: Two character query
- **WHEN** a user searches for "go"
- **THEN** the system returns FTS-only results without invoking the embedding model

#### Scenario: Three character query uses vector search
- **WHEN** a user searches for "api"
- **THEN** the system runs both FTS and vector search as normal

### Requirement: Raised cosine similarity threshold
The system SHALL use a cosine similarity threshold of 0.4 (raised from 0.3) to filter vector search results. Results below this threshold SHALL be excluded.

#### Scenario: Weakly related note is excluded
- **WHEN** a vector search returns a note with cosine similarity 0.35
- **THEN** that note is excluded from vector results (below 0.4 threshold)

#### Scenario: Relevant note passes threshold
- **WHEN** a vector search returns a note with cosine similarity 0.52
- **THEN** that note is included in vector results and contributes to RRF merge

### Requirement: Query embedding cache
The system SHALL cache query embeddings in an LRU cache (capacity: 50 entries). On cache hit, the system SHALL skip embedding model inference and use the cached vector.

#### Scenario: Repeated query hits cache
- **WHEN** a user searches for "kubernetes deployment" twice within the same session
- **THEN** the second search reuses the cached embedding without invoking the E5 model

#### Scenario: Cache eviction on capacity
- **WHEN** the cache holds 50 entries and a new unique query arrives
- **THEN** the least recently used entry is evicted and the new embedding is cached

### Requirement: In-memory vector cache
The system SHALL cache all note embeddings in memory after first load. Subsequent searches SHALL score against the in-memory cache without querying SQLite. The cache SHALL be invalidated per-path when file watcher events trigger re-indexing.

#### Scenario: First search loads from SQLite
- **WHEN** the first search runs after server startup
- **THEN** all embeddings are loaded from SQLite into memory and used for scoring

#### Scenario: Subsequent search uses memory cache
- **WHEN** a second search runs after the in-memory cache is populated
- **THEN** embeddings are scored directly from memory with no SQLite query

#### Scenario: File change invalidates cache entry
- **WHEN** a note is modified and re-indexed
- **THEN** the in-memory cache entry for that path is replaced with the new embeddings

#### Scenario: File deletion removes cache entry
- **WHEN** a note is deleted
- **THEN** the in-memory cache entry for that path is removed
