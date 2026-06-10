## MODIFIED Requirements

### Requirement: Save status state machine
The editor SHALL maintain a save status state with the following states: SYNCED, DIRTY, FLUSH_PENDING, ERROR, DISCONNECTED. Transitions SHALL be driven by OT acks, `flushed` events, `flush:error` events, and WebSocket lifecycle events. The SYNCED state for OT-flushed content SHALL mean: the kernel has accepted the bytes and will flush them to disk within at most 2 seconds (bounded by the background fsync coalescer). It SHALL NOT mean the bytes are guaranteed on physical platter at the moment SYNCED is entered.

#### Scenario: User edits while synced
- **WHEN** the user edits a document in SYNCED state
- **THEN** the state transitions to DIRTY

#### Scenario: Ops acknowledged, awaiting flush
- **WHEN** the server acks an operation in DIRTY state
- **THEN** the state transitions to FLUSH_PENDING

#### Scenario: Flush confirmed
- **WHEN** a `flushed` event is received in FLUSH_PENDING or DIRTY state
- **THEN** the state transitions to SYNCED

#### Scenario: Flush fails
- **WHEN** a `flush:error` event is received
- **THEN** the state transitions to ERROR

#### Scenario: Connection drops at any state
- **WHEN** the WebSocket disconnects from any state
- **THEN** the state transitions to DISCONNECTED

#### Scenario: Recovery from error
- **WHEN** a subsequent flush succeeds (auto-retry) in ERROR state
- **THEN** the state transitions to SYNCED

#### Scenario: Recovery from disconnect
- **WHEN** the WebSocket reconnects and the document is re-synced
- **THEN** the state transitions to SYNCED

#### Scenario: SYNCED durability semantics — tab close
- **WHEN** the editor is in SYNCED state and the user closes the browser tab
- **THEN** the bytes are durable (the kernel will flush regardless of the tab state)

#### Scenario: SYNCED durability semantics — process crash
- **WHEN** the editor is in SYNCED state and the server process crashes
- **THEN** the bytes are durable (the kernel will flush regardless of the process exiting)

#### Scenario: SYNCED durability semantics — hard power loss
- **WHEN** the editor is in SYNCED state and hard power loss occurs within 2 seconds of entering SYNCED
- **THEN** the most recent save MAY be lost; all earlier saves (older than the coalescer interval) are durable
