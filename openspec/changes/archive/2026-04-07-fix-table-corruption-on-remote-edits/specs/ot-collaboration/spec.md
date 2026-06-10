## MODIFIED Requirements

### Requirement: Real-time collaborative editing
The system SHALL support real-time multi-user editing of markdown documents using Operational Transform. The OT engine handles insert, delete, and retain operations. Remote operations applied to the observer's editor SHALL NOT be added to the observer's undo history.

#### Scenario: Two users edit simultaneously
- **WHEN** two users edit the same document at the same time
- **THEN** the server transforms conflicting operations and broadcasts the results so both users converge to the same document state

#### Scenario: User sends operation
- **WHEN** a user sends an OT operation with a revision number
- **THEN** the server transforms the operation against any concurrent operations since that revision, applies it, and broadcasts the transformed operation to other connected clients

#### Scenario: Observer undo does not affect remote edits
- **WHEN** an observer receives remote edits and then presses Ctrl+Z
- **THEN** only the observer's own local edits are undone; remote edits remain in place
