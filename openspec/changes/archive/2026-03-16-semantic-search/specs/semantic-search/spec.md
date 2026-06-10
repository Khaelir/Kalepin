## ADDED Requirements

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
The system SHALL split markdown notes into chunks at heading boundaries (any `#` level). Each chunk SHALL include its heading as a prefix for context.

#### Scenario: Note with multiple headings
- **WHEN** a note contains multiple headings
- **THEN** each heading section becomes a separate chunk with its heading text preserved

#### Scenario: Long section exceeds token limit
- **WHEN** a heading section exceeds approximately 500 tokens (~2000 characters)
- **THEN** the system splits it on paragraph boundaries (double newline) with approximately 100 characters of overlap between chunks

#### Scenario: Short note without headings
- **WHEN** a note has no headings or is shorter than 500 tokens total
- **THEN** the entire note content becomes a single chunk

### Requirement: Store embeddings in SQLite
The system SHALL store embeddings in a `note_embeddings` table with columns: `path` (TEXT), `chunk_idx` (INTEGER), `chunk_text` (TEXT), `heading` (TEXT), and `embedding` (BLOB as Float32Array).

#### Scenario: Embeddings persist across restarts
- **WHEN** the server restarts
- **THEN** previously computed embeddings are available without re-computation

#### Scenario: Upsert on re-index
- **WHEN** a note is re-indexed
- **THEN** all existing embedding rows for that path are deleted before inserting new ones

### Requirement: Hybrid search with Reciprocal Rank Fusion
The `search()` method SHALL run both FTS5 and vector similarity searches, then merge results using Reciprocal Rank Fusion with k=60.

#### Scenario: Query matches both keyword and semantic results
- **WHEN** a search query has both exact keyword matches and semantically similar notes
- **THEN** both appear in results, ranked by combined RRF score

#### Scenario: Query has only semantic matches
- **WHEN** a search query uses different wording than any note (no FTS5 matches)
- **THEN** semantically similar notes are still returned from vector search

#### Scenario: Query has only keyword matches
- **WHEN** a search query matches notes by exact keywords but no notes are semantically close
- **THEN** FTS5 results are returned (vector results contribute zero or low RRF score)

#### Scenario: Results are deduplicated by path
- **WHEN** the same note appears in both FTS5 and vector results
- **THEN** it appears once in the final results with a combined RRF score

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
