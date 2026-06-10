## ADDED Requirements

### Requirement: Defer embedding while OT session is active
For documents with at least one connected client in the OT session manager, `SearchService` SHALL defer embedding generation. Documents without an active session SHALL continue to embed immediately.

#### Scenario: Active OT session defers embedding
- **WHEN** an internal-write or chokidar event fires for `notes/foo.md`
- **AND** `OTSessionManager.getSession("notes/foo.md")` reports `clients.size > 0`
- **THEN** `SearchService` does NOT call the ONNX model immediately
- **AND** the latest content is held for later embedding

#### Scenario: No active session embeds immediately
- **WHEN** an internal-write event fires for `notes/foo.md`
- **AND** the document has no active OT session (no connected clients)
- **THEN** the embedding is generated and stored synchronously (existing behavior)

#### Scenario: MCP-created file embeds immediately
- **WHEN** a file is created or written via the MCP-driven `FilesService.createFile` path with no editor open
- **THEN** the embedding is generated immediately because no OT session exists for that path

### Requirement: Per-document inactivity timer for deferred embeddings
For each document with a deferred embedding, `SearchService` SHALL maintain a per-document inactivity timer with a 45-second window. Each new flush for the document SHALL reset the timer. When the timer fires, the embedding SHALL be generated and stored using the most recently held content.

#### Scenario: Single flush fires after inactivity window
- **WHEN** a flush for `notes/foo.md` enqueues a deferred embedding at time T
- **AND** no further flush for `notes/foo.md` occurs before T+45 s
- **THEN** at T+45 s, the embedding is generated for the held content and `note_embeddings` rows are replaced

#### Scenario: Repeated flushes reset the timer
- **WHEN** flushes for `notes/foo.md` arrive at T, T+10s, T+20s, and T+40s
- **THEN** the embedding does NOT run at T+45s; it runs at T+85s (45 s after the most recent flush) provided no further flush occurs

#### Scenario: Timer holds only the latest content
- **WHEN** multiple flushes for the same path arrive during the inactivity window
- **THEN** the held content for that path is replaced on each flush, and only the final content is embedded when the timer fires

### Requirement: Per-document safety cap for continuous editing
For each document with continuous flushes resetting the inactivity timer, `SearchService` SHALL force an embedding pass at least once every 5 minutes regardless of typing activity. The safety cap SHALL be tracked per document, beginning when the first deferred embedding is enqueued.

#### Scenario: Continuous typing triggers safety cap embedding
- **WHEN** a document receives flushes continuously such that the 45-second inactivity timer never fires
- **AND** 5 minutes have elapsed since the first deferred embedding for that document
- **THEN** an embedding pass runs against the latest held content and the safety-cap clock resets

#### Scenario: Safety cap does not run when no deferred embedding is pending
- **WHEN** a document has no pending deferred embedding (e.g., it just had one run)
- **THEN** the safety-cap timer is not active for that document

### Requirement: Embed on session close
When the last client disconnects from a document's OT session and a deferred embedding is pending, `SearchService` SHALL generate the embedding immediately as part of the session-close handler.

#### Scenario: Last client disconnects flushes pending embedding
- **WHEN** a document has a pending deferred embedding
- **AND** the last connected client disconnects, triggering session close
- **THEN** the embedding is generated for the held content before the session is fully closed

#### Scenario: Session close with no pending embedding is a no-op
- **WHEN** a session closes for a document that has no pending deferred embedding
- **THEN** no embedding action is taken

### Requirement: Flush all pending deferred embeddings on shutdown
On `beforeExit` (or a captured SIGTERM), `SearchService` SHALL synchronously generate any pending deferred embeddings before allowing the process to exit, with a soft total-time budget so a stuck embed does not block shutdown indefinitely.

#### Scenario: Shutdown runs pending embeddings
- **WHEN** the process receives `beforeExit` with deferred embeddings pending for two documents
- **THEN** both documents are embedded before the process exits, in any order

#### Scenario: Shutdown budget exceeded
- **WHEN** pending embeddings would take longer than the configured budget (default 30 seconds)
- **THEN** the process exits after the budget elapses; remaining un-embedded documents will be picked up by the heal sweep on next startup
