## MODIFIED Requirements

### Requirement: User presence per document
The system SHALL track which users are currently viewing or editing each document and display presence indicators. The WebSocket client SHALL emit lifecycle events when the connection state changes.

#### Scenario: User opens a document
- **WHEN** a user opens a document
- **THEN** the server adds the user to the document's presence list and broadcasts the updated presence to all clients viewing that document

#### Scenario: User closes a document
- **WHEN** a user closes a document or disconnects
- **THEN** the server removes the user from the document's presence list and broadcasts the update

#### Scenario: WebSocket connection established
- **WHEN** the WebSocket connection opens (initial or reconnect)
- **THEN** the WSClient emits a `connected` event to all registered handlers

#### Scenario: WebSocket connection lost
- **WHEN** the WebSocket connection closes unexpectedly
- **THEN** the WSClient emits a `disconnected` event to all registered handlers

## ADDED Requirements

### Requirement: WebSocket exponential reconnect backoff
The WSClient SHALL use exponential backoff when reconnecting after a disconnection, starting at 2 seconds, doubling on each failure, capped at 30 seconds. The backoff SHALL reset to the initial delay on successful connection.

#### Scenario: First reconnect attempt
- **WHEN** the WebSocket disconnects for the first time
- **THEN** the client waits 2 seconds before attempting to reconnect

#### Scenario: Subsequent reconnect attempts
- **WHEN** a reconnect attempt fails
- **THEN** the client doubles the delay (4s, 8s, 16s, 30s) up to a maximum of 30 seconds

#### Scenario: Successful reconnect resets backoff
- **WHEN** a reconnect attempt succeeds
- **THEN** the backoff delay resets to 2 seconds

### Requirement: Document re-sync on reconnect
The client SHALL re-open the document after a WebSocket reconnection to obtain fresh content and revision state. A new OTClient SHALL be created with the server-provided state.

#### Scenario: Reconnect triggers re-sync
- **WHEN** the WebSocket reconnects after a disconnection
- **THEN** the client sends a `doc:open` message for the current document

#### Scenario: Re-sync completes
- **WHEN** the server responds to `doc:open` with fresh content and revision
- **THEN** the client creates a new OTClient with the server-provided revision, updates the editor content to match the server state, and transitions the save state to SYNCED
