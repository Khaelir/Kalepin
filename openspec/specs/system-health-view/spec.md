## Purpose

Admin system health dashboard showing process, database, and storage metrics.

## Requirements

### Requirement: System health data collection
The system SHALL collect system health metrics on demand when the `system` view is requested, not pre-computed or cached.

#### Scenario: DB file size
- **WHEN** the system view is requested
- **THEN** the response includes `db.fileSizeBytes` computed via SQLite `PRAGMA page_count * page_size`

#### Scenario: Table row counts
- **WHEN** the system view is requested
- **THEN** the response includes `db.tables` with row counts for: `notes_fts`, `note_embeddings`, `comments_fts`, `mcp_usage_log`, `daily_stats`, `failed_searches`

#### Scenario: Embedding coverage
- **WHEN** the system view is requested
- **THEN** the response includes `db.embeddingCoverage` with `indexedNotes` (distinct paths in note_embeddings where source='note'), `totalNotes` (count from notes_fts), and `percentage`

#### Scenario: FTS coverage
- **WHEN** the system view is requested
- **THEN** the response includes `db.ftsCoverage` with `indexedNotes` (count from notes_fts), `totalFiles` (markdown files on disk), and `percentage`

### Requirement: Vault stats
The system SHALL include vault-level statistics in the system health response.

#### Scenario: Note and attachment counts
- **WHEN** the system view is requested
- **THEN** the response includes `vault.noteCount`, `vault.attachmentCount`, and `vault.attachmentSizeBytes`

#### Scenario: Comment thread stats
- **WHEN** the system view is requested
- **THEN** the response includes `vault.openThreads` and `vault.resolvedThreads` counts

### Requirement: Runtime stats
The system SHALL include runtime information in the system health response.

#### Scenario: Server uptime
- **WHEN** the system view is requested
- **THEN** the response includes `runtime.uptimeSeconds` (process uptime)

#### Scenario: Embedding model status
- **WHEN** the system view is requested
- **THEN** the response includes `runtime.embeddingModel` with `ready` (boolean) and `modelName` (string)

#### Scenario: Vector cache status
- **WHEN** the system view is requested
- **THEN** the response includes `runtime.vectorCache` with `loaded` (boolean), `chunkCount` (number of cached chunks), and `estimatedSizeBytes` (chunkCount * EMBEDDING_DIM * 4)

#### Scenario: Active OT sessions
- **WHEN** the system view is requested
- **THEN** the response includes `runtime.otSessions` as an array of `{ docId, clientCount, revision }` for each active editing session
