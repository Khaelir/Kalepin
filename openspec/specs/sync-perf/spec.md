## Purpose

Avoids external change notifications for OT-originated writes so collaborative edits do not echo through the file watcher.

## Requirements

### Requirement: OT-originated writes SHALL NOT trigger external change notifications

The server SHALL distinguish between file writes caused by OT flush and genuinely external file modifications. When a file change event is detected for a document with an active OT session, the server SHALL suppress the `file:changed` broadcast to clients.

#### Scenario: OT flush does not trigger reload
- **WHEN** the OT session manager flushes a document to disk after 3 seconds of inactivity
- **THEN** no `file:changed` event is broadcast to connected clients for that document

#### Scenario: External edit on file without active session triggers notification
- **WHEN** a file is modified on disk by an external process and no OT session exists for that file
- **THEN** the server broadcasts a `file:changed` event to connected clients as before

#### Scenario: External edit on file with active session is suppressed
- **WHEN** a file is modified on disk by an external process while an OT session is active for that file
- **THEN** the server suppresses the `file:changed` event (OT session is source of truth)

### Requirement: OT operation composition SHALL produce valid compact operations

The client-side `composeOps` function SHALL properly compose two OT operations into a single equivalent operation, merging adjacent retain, insert, and delete components. The composed operation SHALL be semantically equivalent to applying both operations in sequence.

#### Scenario: Rapid typing while awaiting server ack
- **WHEN** the OT client is in `AwaitingWithBuffer` state and receives additional local operations
- **THEN** the buffer is composed into a single operation whose retain+delete count matches the intermediate document length

#### Scenario: Composed operation produces same result as sequential application
- **WHEN** operations A and B are composed into C
- **THEN** applying C to a document produces the same result as applying A then B

### Requirement: Shadow markdown SHALL be re-synced after applying remote content

After `editor.commands.setContent(markdown)` is called to apply a remote operation, the shadow reference (`shadowRef`) SHALL be updated to the result of `editor.storage.markdown.getMarkdown()` — not the raw markdown that was passed to `setContent`. This ensures the shadow always reflects what TipTap actually parsed and would serialize.

#### Scenario: Table normalization during roundtrip
- **WHEN** a remote operation produces markdown with a table `| col1 | col2 |` and TipTap normalizes it to `| col1  | col2  |` during parse
- **THEN** the shadow SHALL contain the normalized form `| col1  | col2  |`
- **AND** the next local edit SHALL diff against the normalized shadow, producing no spurious operations

#### Scenario: Consecutive remote operations do not accumulate drift
- **WHEN** 10 consecutive remote operations are applied to a document containing tables
- **THEN** the shadow SHALL match `getMarkdown()` after each operation
- **AND** no spurious operations SHALL be sent to the server as a result of roundtrip normalization

#### Scenario: Shadow re-sync does not trigger local operation
- **WHEN** `setContent` is called with `isRemoteRef` set to true and the shadow is re-synced afterward
- **THEN** the `onTransaction` handler SHALL not generate or send any OT operations for that content change
