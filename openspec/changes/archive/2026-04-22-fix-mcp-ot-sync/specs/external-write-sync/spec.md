## ADDED Requirements

### Requirement: External write notification
FilesService SHALL emit a `file:written` event after writing a file to storage via `createFile()`. The event MUST include the file path.

#### Scenario: MCP creates a note
- **WHEN** MCP calls `filesService.createFile("notes/foo.md", content)`
- **THEN** a `file:written` event is emitted with path `notes/foo.md` after the storage write completes

#### Scenario: MCP edits an existing note
- **WHEN** MCP calls `filesService.createFile("notes/existing.md", newContent)` for a file that already exists
- **THEN** a `file:written` event is emitted with path `notes/existing.md` after the storage write completes

### Requirement: OT session reset on external write
When a `file:written` event fires for a document with an active OT session, the system SHALL reset the session content to match the disk content and notify all connected clients.

#### Scenario: External write to document with active OT session
- **WHEN** `file:written` fires for a document that has an active OT session
- **THEN** the session content is replaced with the new disk content, the revision is incremented, the operation history is cleared, and a `doc:reload` message is broadcast to all connected clients

#### Scenario: External write to document without active OT session
- **WHEN** `file:written` fires for a document that has no active OT session
- **THEN** no session reset occurs (the file watcher handles notification via `file:changed`)

### Requirement: Client reload on doc:reload
When the frontend receives a `doc:reload` WebSocket message for the currently viewed document, it SHALL re-open the document through the standard `doc:open` flow to receive fresh content and revision.

#### Scenario: Frontend receives doc:reload for current document
- **WHEN** the frontend receives `doc:reload` with path matching the currently open document
- **THEN** the frontend re-sends `doc:open` and updates the editor with the fresh content and revision from the response

#### Scenario: Frontend receives doc:reload for a different document
- **WHEN** the frontend receives `doc:reload` with a path that does not match the currently open document
- **THEN** the message is ignored
