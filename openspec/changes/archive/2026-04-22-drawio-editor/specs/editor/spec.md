## ADDED Requirements

### Requirement: Image extension draw.io awareness
The image extension SHALL detect draw.io SVGs and provide additional actions.

#### Scenario: Image extension renders draw.io SVG
- **WHEN** the `ImageWithAttachments` extension renders an SVG that contains draw.io metadata
- **THEN** a "draw.io" badge and "Edit" action button are added to the hover action bar
- **THEN** clicking "Edit" opens the fullscreen draw.io editor modal

#### Scenario: Code block draw.io detection
- **WHEN** a code block contains draw.io XML (`<mxfile` or `<mxGraphModel`)
- **THEN** an informational banner is shown guiding the user to export as SVG

## MODIFIED Requirements

### Requirement: Slash commands
The system SHALL provide slash commands for quick content insertion. V1 commands: `/table`, `/task`, `/heading`, `/divider`, `/code`, `/callout`, `/link`, `/mermaid`, `/drawio`.

#### Scenario: User types slash
- **WHEN** a user types `/` at the beginning of a line or after a space
- **THEN** a dropdown menu appears with available commands, filtered as the user types

#### Scenario: User selects a slash command
- **WHEN** a user selects `/table` from the slash command menu
- **THEN** the editor inserts a markdown table template at the cursor position

#### Scenario: Slash command renders rich but serializes to markdown
- **WHEN** a user inserts a `/callout` via slash command
- **THEN** the editor renders it as a styled callout block, but the file on disk contains standard markdown (e.g., blockquote syntax)

#### Scenario: User inserts draw.io diagram via slash command
- **WHEN** a user selects `/drawio` from the slash command menu
- **THEN** a new empty draw.io SVG is created and inserted as an image
- **THEN** the draw.io editor modal opens immediately
