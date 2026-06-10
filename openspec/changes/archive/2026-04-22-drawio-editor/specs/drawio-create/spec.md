## ADDED Requirements

### Requirement: Slash command to create new draw.io diagram
A `/drawio` slash command SHALL create a new empty draw.io SVG and open the editor immediately.

#### Scenario: User invokes /drawio command
- **WHEN** the user types `/drawio` and selects the command
- **THEN** a new empty draw.io SVG is created in `_attachments/`
- **THEN** a markdown image reference is inserted at the cursor position
- **THEN** the fullscreen draw.io editor modal opens immediately with the blank diagram

#### Scenario: User saves new diagram
- **WHEN** the user draws a diagram and saves from the editor
- **THEN** the SVG in `_attachments/` is updated with the diagram content
- **THEN** the markdown reference is updated if the content hash changed

#### Scenario: User cancels without saving
- **WHEN** the user closes the editor modal without saving on a new diagram
- **THEN** the empty SVG and markdown reference are cleaned up
- **THEN** no orphan attachment is left behind
