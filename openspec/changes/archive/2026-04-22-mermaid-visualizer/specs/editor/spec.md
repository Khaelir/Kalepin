## MODIFIED Requirements

### Requirement: Slash commands
The system SHALL provide slash commands for quick content insertion. Commands: `/table`, `/task`, `/heading`, `/divider`, `/code`, `/callout`, `/link`, `/mermaid`.

#### Scenario: User types slash
- **WHEN** a user types `/` at the beginning of a line or after a space
- **THEN** a dropdown menu appears with available commands, filtered as the user types

#### Scenario: User selects a slash command
- **WHEN** a user selects `/table` from the slash command menu
- **THEN** the editor inserts a markdown table template at the cursor position

#### Scenario: Slash command renders rich but serializes to markdown
- **WHEN** a user inserts a `/callout` via slash command
- **THEN** the editor renders it as a styled callout block, but the file on disk contains standard markdown (e.g., blockquote syntax)

#### Scenario: User inserts mermaid diagram via slash command
- **WHEN** a user selects `/mermaid` from the slash command menu
- **THEN** the editor inserts a code block with language `mermaid` containing a starter template
- **THEN** the block starts in source editing mode so the user can immediately edit the diagram
