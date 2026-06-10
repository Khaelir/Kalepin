## ADDED Requirements

### Requirement: Real-time collaborative editing
The system SHALL support real-time multi-user editing of markdown documents using Operational Transform. The OT engine handles insert, delete, and retain operations.

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
- **THEN** the server rejects the operation and the client MUST resync the document

### Requirement: OT operation history
The system SHALL store OT operation history in SQLite for replay and debugging. History MUST be prunable.

#### Scenario: Operations persisted
- **WHEN** the server applies an OT operation
- **THEN** the operation is stored in the `ot_operation_history` table with the document ID and revision number

#### Scenario: History pruning
- **WHEN** an administrator triggers history pruning for a document
- **THEN** operations older than the configured retention period are deleted

### Requirement: Document flush to disk
The system SHALL debounce writes to disk during active editing and flush the final document state when a session closes.

#### Scenario: Debounced write during editing
- **WHEN** OT operations are applied to a document
- **THEN** the server debounces writes to the markdown file on disk (e.g., every 2-5 seconds of inactivity)

#### Scenario: Flush on session close
- **WHEN** the last user disconnects from a document or an inactivity timeout fires
- **THEN** the server writes the final document state to disk immediately
