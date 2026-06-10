## Purpose

Real-time collaborative editing of notes using operational transform over WebSocket.
## Requirements
### Requirement: Real-time collaborative editing
The system SHALL support real-time multi-user editing of markdown documents using Operational Transform. The OT engine handles insert, delete, and retain operations. Remote operations applied to the observer's editor SHALL NOT be added to the observer's undo history.

#### Scenario: Two users edit simultaneously
- **WHEN** two users edit the same document at the same time
- **THEN** the server transforms conflicting operations and broadcasts the results so both users converge to the same document state

#### Scenario: User sends operation
- **WHEN** a user sends an OT operation with a revision number
- **THEN** the server transforms the operation against any concurrent operations since that revision, applies it, and broadcasts the transformed operation to other connected clients

### Requirement: OT operation batching
The system SHALL batch OT operations at the ProseMirror transaction level. Transactions are typically a few keystrokes and fire within ~2 seconds.

#### Scenario: User types text
- **WHEN** a user types characters that produce a ProseMirror transaction
- **THEN** the client sends the transaction as a single OT operation batch to the server

### Requirement: Server-authoritative OT
The server SHALL be the single source of truth for document state. All operations MUST be acknowledged by the server before being considered committed.

#### Scenario: Operation acknowledged
- **WHEN** the server successfully applies a client's operation
- **THEN** the server sends an ack message with the new revision number to the originating client

#### Scenario: Operation rejected
- **WHEN** a client sends an operation based on a stale revision that cannot be transformed
- **THEN** the server rejects the operation and sends an error message to the client

### Requirement: OT operation history
The system SHALL store OT operation history in SQLite for replay and debugging. History MUST be prunable.

#### Scenario: Operations persisted
- **WHEN** the server applies an OT operation
- **THEN** the operation is stored in the `ot_operation_history` table with the document ID and revision number

#### Scenario: History pruning
- **WHEN** an administrator triggers history pruning for a document
- **THEN** operations older than the configured retention period are deleted

### Requirement: Document flush to disk
The system SHALL debounce writes to disk during active editing and flush the final document state when a session closes. The dirty flag SHALL only be cleared after a successful flush. On flush failure, the dirty flag SHALL remain set so the next debounce cycle retries the write.

#### Scenario: Debounced write during editing
- **WHEN** OT operations are applied to a document
- **THEN** the server debounces writes to the markdown file on disk (e.g., every 2-5 seconds of inactivity)

#### Scenario: Flush on session close
- **WHEN** the last user disconnects from a document or an inactivity timeout fires
- **THEN** the server writes the final document state to disk immediately

#### Scenario: Dirty flag cleared after successful flush
- **WHEN** the debounced flush writes content to disk successfully
- **THEN** the dirty flag is cleared after the write completes

#### Scenario: Dirty flag preserved on flush failure
- **WHEN** the debounced flush fails (disk error, permissions, etc.)
- **THEN** the dirty flag remains set so the next debounce or manual flush retries the write

### Requirement: Flush confirmation event
The server SHALL emit a `flushed` WebSocket event to all clients connected to a document after a successful flush to disk. This event is the authoritative signal that content has been persisted.

#### Scenario: Flush succeeds
- **WHEN** the server successfully writes document content to disk
- **THEN** the server broadcasts a `flushed` event with the document ID to all connected clients for that document

#### Scenario: Flush fails
- **WHEN** the server fails to write document content to disk
- **THEN** the server broadcasts a `flush:error` event with the document ID and error context to all connected clients for that document

### Requirement: Manual flush response
The `doc:flush` handler SHALL send a response back to the requesting client confirming success or failure.

#### Scenario: Manual flush succeeds
- **WHEN** a client sends a `doc:flush` message and the flush succeeds
- **THEN** the server sends a `flushed` event to the requesting client (in addition to the broadcast)

#### Scenario: Manual flush fails
- **WHEN** a client sends a `doc:flush` message and the flush fails
- **THEN** the server sends a `flush:error` event to the requesting client

### Requirement: OT client error handling
The OT client SHALL listen for `error` messages from the server and surface them to the editor for state machine transitions.

#### Scenario: Server rejects operation
- **WHEN** the server sends an `error` message for a rejected operation
- **THEN** the OT client invokes an error callback so the editor can transition to ERROR state

#### Scenario: OT client stuck in AwaitingConfirm
- **WHEN** the OT client receives an `error` message while in AwaitingConfirm state
- **THEN** the OT client resets its state and invokes the error callback

### Requirement: Confirmed shadow for rollback
The OT client SHALL maintain a confirmed shadow (last server-acknowledged document state) alongside the optimistic shadow (updated on each local edit). On error or disconnect, the confirmed shadow SHALL be the rollback point.

#### Scenario: Shadow updated on ack
- **WHEN** the server acknowledges a local operation
- **THEN** the confirmed shadow is updated to reflect the acknowledged state

#### Scenario: Shadow rollback on error
- **WHEN** the OT client receives an error or the connection drops
- **THEN** the optimistic shadow is reset to the confirmed shadow value

### Requirement: Session close race guard
The session manager SHALL NOT delete a session if new clients have joined during an async flush operation.

#### Scenario: New client joins during close flush
- **WHEN** the last client disconnects, triggering a close flush, and a new client opens the same document before the flush completes
- **THEN** the session is NOT deleted after the flush; the new client's session remains active

### Requirement: OT history trimming
The session manager SHALL trim operation history to a configurable sliding window to prevent unbounded memory growth.

#### Scenario: History exceeds window
- **WHEN** the operation history grows beyond the configured window size (default 1000)
- **THEN** the oldest entries are trimmed after each flush, keeping only the most recent entries within the window

### Requirement: Session content reset
OTSessionManager SHALL provide a `resetContent(docId, newContent)` method that atomically replaces a session's content, increments its revision, clears operation history, and updates the last-flushed content marker.

#### Scenario: Reset session with new content
- **WHEN** `resetContent("notes/foo.md", newContent)` is called on a session with existing content
- **THEN** `session.content` is set to `newContent`, `session.revision` is incremented by 1, `session.history` is cleared, `session.dirty` is set to `false`, and `session.lastFlushedContent` is set to `newContent`

#### Scenario: Reset non-existent session
- **WHEN** `resetContent("notes/nonexistent.md", content)` is called with no active session for that doc
- **THEN** the method returns without error (no-op)

### Requirement: File watcher handles add events for content
The OT gateway file watcher SHALL treat `add` events on `.md` files the same as `change` events for the purpose of broadcasting `file:changed` to clients. The OT session check (suppress if session owns the doc) MUST still apply.

#### Scenario: New markdown file created externally with no OT session
- **WHEN** the file watcher detects an `add` event for a `.md` file with no active OT session
- **THEN** a `file:changed` message is broadcast to clients viewing that document

#### Scenario: New markdown file created externally with active OT session
- **WHEN** the file watcher detects an `add` event for a `.md` file with an active OT session
- **THEN** the `file:changed` broadcast is suppressed (same as `change` event behavior)

### Requirement: Watcher events for atomic-write tmp paths are not broadcast

The OT gateway's chokidar handlers (both shared-vault and per-user-personal) SHALL drop events whose path matches the atomic-write tmp pattern (`*.tmp.<hex>`). Neither `file:changed` nor `file:tree-update` events SHALL be emitted for such paths.

#### Scenario: Atomic write produces no client-visible event
- **WHEN** `LocalFSAdapter.writeBytesAtomic('Notes/foo.md', …)` runs (creating `Notes/foo.md.tmp.0d8580583738`, then renaming)
- **THEN** no connected WebSocket client receives a `file:changed` or `file:tree-update` event whose `path` ends in `.tmp.<hex>`
- **AND** the rename-into-place still produces the expected `file:changed` for `Notes/foo.md`

#### Scenario: Direct write of a non-tmp path is unaffected
- **WHEN** `LocalFSAdapter.write('Notes/bar.md', …)` runs (no tmp file)
- **THEN** the watcher emits `file:changed` for `Notes/bar.md` as before

### Requirement: Active-document echo is suppressed when OT recently delivered the revision

When the frontend receives a `file:changed` for the currently-active document and the local OT session has received a revision update within the last 2 seconds, the user-visible toast SHALL be suppressed. The editor content refresh path is unchanged.

#### Scenario: OT save produces no echo toast
- **GIVEN** the active document is `Notes/foo.md`
- **AND** the OT session received revision N at time T
- **WHEN** a `file:changed` event for `Notes/foo.md` arrives at time T + 1s
- **THEN** no toast is shown

#### Scenario: External editor produces an echo toast
- **GIVEN** the active document is `Notes/foo.md`
- **AND** the OT session has not received any revision in the last 10 seconds
- **WHEN** a `file:changed` event for `Notes/foo.md` arrives
- **THEN** the toast `File changed externally: Notes/foo.md` is shown

