## ADDED Requirements

### Requirement: FTS5 indexing of comment text
The system SHALL maintain a `comments_fts` FTS5 virtual table that indexes all comment text from `.collab` sidecar files. Each row SHALL contain the note path, thread ID, and concatenated comment text for that thread.

#### Scenario: Comment indexed on creation
- **WHEN** a user creates a new comment via `addComment`
- **THEN** the system SHALL index all comment threads for that note path in `comments_fts`

#### Scenario: Comment indexed on reply
- **WHEN** a user replies to a thread via `replyToThread`
- **THEN** the system SHALL re-index all comment threads for that note path in `comments_fts`

#### Scenario: Comment removed from index on deletion
- **WHEN** a user deletes a comment via `deleteComment`
- **THEN** the system SHALL re-index all comment threads for that note path in `comments_fts`, removing threads that no longer exist

#### Scenario: FTS content includes all comment text in a thread
- **WHEN** a thread has multiple comments from different authors
- **THEN** the FTS entry for that thread SHALL contain the concatenated text of all comments in the thread, plus the `quotedText` if present

### Requirement: Vector embedding of comment text
The system SHALL generate vector embeddings for comment text and store them in the `note_embeddings` table with `source = 'comment'`. The primary key SHALL be `(path, source, chunk_idx)`.

#### Scenario: Embedding generated on comment write
- **WHEN** a comment is created or replied to and the embedding service is ready
- **THEN** the system SHALL generate embeddings for all comment threads on that note and store them with `source = 'comment'`

#### Scenario: Graceful degradation without embeddings
- **WHEN** the embedding service is not ready
- **THEN** comment text SHALL still be indexed in FTS5, and comment embedding indexing SHALL be skipped without error

### Requirement: Full re-index includes comments
The `reindexAll` method SHALL scan all `.collab` sidecar files and index their comment text into both `comments_fts` and `note_embeddings` (with `source = 'comment'`).

#### Scenario: Cold start re-index
- **WHEN** the application starts with an empty index
- **THEN** `reindexAll` SHALL index all notes AND all comments from their sidecar files

#### Scenario: Manual re-index via API
- **WHEN** a user triggers `POST /api/search/reindex`
- **THEN** both note and comment indexes SHALL be rebuilt from scratch

### Requirement: Source column on note_embeddings
The `note_embeddings` table SHALL have a `source TEXT NOT NULL DEFAULT 'note'` column. Existing note embeddings SHALL use `source = 'note'`. Comment embeddings SHALL use `source = 'comment'`.

#### Scenario: Migration adds source column
- **WHEN** the application starts and the `source` column does not exist on `note_embeddings`
- **THEN** the system SHALL add the column with `ALTER TABLE` and default value `'note'`, preserving existing data
