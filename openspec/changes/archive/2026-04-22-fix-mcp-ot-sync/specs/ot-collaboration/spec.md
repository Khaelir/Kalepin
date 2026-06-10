## ADDED Requirements

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
