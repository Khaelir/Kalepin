## ADDED Requirements

### Requirement: Threaded comments per block
The system SHALL support threaded comments anchored to specific blocks in a document. Each block anchor is an invisible HTML comment (`<!-- bid:xx -->`) in the markdown.

#### Scenario: Add a comment to a block
- **WHEN** a user selects text or a block and adds a comment
- **THEN** the system inserts a block anchor (if not present), creates a comment thread in the sidecar file, and broadcasts the new comment to other connected clients

#### Scenario: Reply to a comment thread
- **WHEN** a user replies to an existing comment thread
- **THEN** the reply is appended to the thread in the sidecar file and broadcast to connected clients

### Requirement: Comment resolution
The system SHALL allow users to resolve and unresolve comment threads.

#### Scenario: Resolve a thread
- **WHEN** a user resolves a comment thread
- **THEN** the thread's `resolved` flag is set to `true` in the sidecar file and the UI updates for all connected clients

#### Scenario: Unresolve a thread
- **WHEN** a user unresolves a previously resolved thread
- **THEN** the thread's `resolved` flag is set to `false` and the UI updates

### Requirement: Comment deletion
The system SHALL allow users to delete their own comments.

#### Scenario: Delete a comment
- **WHEN** a user deletes one of their own comments
- **THEN** the comment is removed from the sidecar file and the UI updates for all connected clients

#### Scenario: Delete last comment in thread
- **WHEN** a user deletes the last remaining comment in a thread
- **THEN** the entire thread is removed from the sidecar file and the block anchor MAY be cleaned up

### Requirement: Sidecar file storage
Comments SHALL be stored in sidecar files named `.{filename}.collab` in the same directory as the markdown file. The sidecar file uses JSON format.

#### Scenario: Sidecar file creation
- **WHEN** the first comment is added to a document that has no sidecar file
- **THEN** the system creates the sidecar file with the comment data

#### Scenario: Sidecar file read on document open
- **WHEN** a user opens a document that has a sidecar file
- **THEN** the system reads the sidecar and loads all comments into the comments panel

### Requirement: Comment real-time sync
Comments SHALL be synchronized in real-time via WebSocket messages (`comment:new`, `comment:update`, `comment:delete`).

#### Scenario: Comment created by another user
- **WHEN** another user adds a comment to a document the current user has open
- **THEN** the comment appears in the current user's comments panel without page refresh
