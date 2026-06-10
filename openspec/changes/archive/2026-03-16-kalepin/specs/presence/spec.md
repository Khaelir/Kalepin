## ADDED Requirements

### Requirement: User presence per document
The system SHALL track which users are currently viewing or editing each document and display presence indicators.

#### Scenario: User opens a document
- **WHEN** a user opens a document
- **THEN** the server adds the user to the document's presence list and broadcasts the updated presence to all clients viewing that document

#### Scenario: User closes a document
- **WHEN** a user closes a document or disconnects
- **THEN** the server removes the user from the document's presence list and broadcasts the update

### Requirement: Cursor and selection sharing
The system SHALL broadcast cursor positions and text selections to other users viewing the same document.

#### Scenario: User moves cursor
- **WHEN** a user moves their cursor in a document
- **THEN** the client sends a presence update with the cursor position, and other clients display the cursor with the user's avatar/color

#### Scenario: User selects text
- **WHEN** a user selects text in a document
- **THEN** the selection range is broadcast and displayed as a colored highlight on other clients

### Requirement: Presence indicators in UI
The system SHALL display avatar pills for each user currently viewing a document.

#### Scenario: Multiple users on same document
- **WHEN** three users are viewing the same document
- **THEN** three avatar pills are displayed in the editor header, each showing the user's identifier (email initial or avatar)
