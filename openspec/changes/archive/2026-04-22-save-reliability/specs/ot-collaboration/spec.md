## MODIFIED Requirements

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

### Requirement: Server-authoritative OT
The server SHALL be the single source of truth for document state. All operations MUST be acknowledged by the server before being considered committed.

#### Scenario: Operation acknowledged
- **WHEN** the server successfully applies a client's operation
- **THEN** the server sends an ack message with the new revision number to the originating client

#### Scenario: Operation rejected
- **WHEN** a client sends an operation based on a stale revision that cannot be transformed
- **THEN** the server rejects the operation and sends an error message to the client

## ADDED Requirements

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
