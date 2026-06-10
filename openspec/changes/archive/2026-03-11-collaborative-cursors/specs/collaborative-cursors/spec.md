## ADDED Requirements

### Requirement: Broadcast local cursor position
The editor SHALL send a `presence` WebSocket message containing the current cursor position and selection range whenever the local user's selection changes. Messages SHALL be throttled to at most one every 50ms.

#### Scenario: User moves cursor
- **WHEN** the user moves the cursor to a new position in the editor
- **THEN** a `presence` message is sent with `cursor` set to the ProseMirror position and `selection` set to `null`

#### Scenario: User selects text
- **WHEN** the user selects a range of text in the editor
- **THEN** a `presence` message is sent with `cursor` set to `selection.head` and `selection` set to `{ from, to }` matching the selection range

#### Scenario: Rapid cursor movement
- **WHEN** the user moves the cursor multiple times within 50ms
- **THEN** only the latest position SHALL be sent

### Requirement: Render remote user cursors
The editor SHALL display a colored vertical caret at each remote user's cursor position. The caret color SHALL match the user's assigned color from the shared color palette (deterministic hash of userId).

#### Scenario: Remote user has cursor in document
- **WHEN** a `presence` message is received with a non-null cursor position for a remote user
- **THEN** a colored caret decoration is rendered at that position in the editor

#### Scenario: Remote user leaves document
- **WHEN** a `presence:leave` message is received for a remote user
- **THEN** the caret decoration for that user is removed from the editor

### Requirement: Render remote user selections
The editor SHALL display a semi-transparent colored highlight over each remote user's active selection range. The highlight color SHALL match the user's assigned cursor color.

#### Scenario: Remote user has active selection
- **WHEN** a `presence` message is received with a non-null selection range for a remote user
- **THEN** a colored inline highlight decoration is rendered over the selection range

#### Scenario: Remote user collapses selection
- **WHEN** a `presence` message is received with a null selection for a remote user who previously had a selection
- **THEN** the highlight decoration is removed and only the caret remains

### Requirement: Display user label on cursor
Each remote cursor caret SHALL display a small label showing the user's name or email. The label SHALL appear above the caret and use the same color as the caret.

#### Scenario: Cursor label visibility
- **WHEN** a remote user's cursor is visible in the viewport
- **THEN** a label with the user's email is shown above the caret

#### Scenario: Label does not interfere with editing
- **WHEN** the local user clicks near a remote cursor label
- **THEN** the click passes through to the editor and does not select or interact with the label element

### Requirement: Consistent colors between cursors and presence avatars
The cursor color, selection highlight color, and presence avatar color for a given user SHALL all be derived from the same color function and palette.

#### Scenario: Color consistency
- **WHEN** a remote user's cursor and avatar are both visible
- **THEN** the cursor caret color, selection highlight color, and avatar background color are identical
