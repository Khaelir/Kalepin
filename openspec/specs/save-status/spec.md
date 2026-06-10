# save-status Specification

## Purpose
TBD - created by archiving change save-reliability. Update Purpose after archive.
## Requirements
### Requirement: Save status state machine
The editor SHALL maintain a save status state with the following states: SYNCED, DIRTY, FLUSH_PENDING, ERROR, DISCONNECTED. Transitions SHALL be driven by OT acks, `flushed` events, `flush:error` events, and WebSocket lifecycle events.

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

### Requirement: Save status indicator
The editor SHALL display a persistent save status indicator reflecting the current state of the save state machine.

#### Scenario: Synced state display
- **WHEN** the save state is SYNCED
- **THEN** the indicator displays "Saved" with a checkmark

#### Scenario: Saving state display
- **WHEN** the save state is DIRTY or FLUSH_PENDING
- **THEN** the indicator displays "Saving..."

#### Scenario: Error state display
- **WHEN** the save state is ERROR
- **THEN** the indicator displays "Save failed" with an error icon

#### Scenario: Disconnected state display
- **WHEN** the save state is DISCONNECTED
- **THEN** the indicator displays "Connection lost" with a warning icon

### Requirement: Hard blocker banner on failure
The editor SHALL display a persistent, undismissable banner above the editor when in ERROR or DISCONNECTED state. The banner SHALL remain visible until the problem resolves.

#### Scenario: Disconnect banner
- **WHEN** the WebSocket disconnects
- **THEN** a banner appears above the editor stating "Connection lost — your changes are not being saved" with a "Reconnecting..." status

#### Scenario: Save error banner
- **WHEN** a flush fails
- **THEN** a banner appears above the editor stating "Save failed" with error context

#### Scenario: Banner removal on recovery
- **WHEN** the save state transitions from ERROR or DISCONNECTED back to SYNCED
- **THEN** the banner is removed

### Requirement: Editor read-only lockdown on failure
The editor SHALL become read-only and visually grayed out when in ERROR or DISCONNECTED state. The editor SHALL become editable again when the state recovers to SYNCED.

#### Scenario: Disconnect locks editor
- **WHEN** the WebSocket disconnects
- **THEN** the editor becomes read-only and its content is visually dimmed

#### Scenario: Recovery unlocks editor
- **WHEN** the state transitions from DISCONNECTED to SYNCED after reconnect and re-sync
- **THEN** the editor becomes editable and visual dimming is removed

### Requirement: Copy button in error banner
The banner SHALL include a "Copy content" button that copies the current editor content to the clipboard, even when the editor is read-only.

#### Scenario: User copies content during disconnect
- **WHEN** the user clicks "Copy content" in the disconnect banner
- **THEN** the full editor content (as markdown) is copied to the system clipboard

### Requirement: beforeunload guard
The editor SHALL register a `beforeunload` handler that warns the user when there are unconfirmed changes (any state other than SYNCED).

#### Scenario: User closes tab with unsaved changes
- **WHEN** the user attempts to close the tab while in DIRTY or FLUSH_PENDING state
- **THEN** the browser displays a "You have unsaved changes" confirmation dialog

#### Scenario: User closes tab while synced
- **WHEN** the user attempts to close the tab while in SYNCED state
- **THEN** no confirmation dialog is shown

