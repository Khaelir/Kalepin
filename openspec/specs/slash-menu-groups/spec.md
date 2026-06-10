## Purpose

Groups slash commands into labeled sections (e.g., Basic, Advanced) for easier discovery.

## Requirements

### Requirement: Commands belong to groups
Each slash command SHALL have a `group` property assigning it to a named group. Groups are: `basic` (Heading, Task, Divider, Callout), `insert` (Table, Code Block, Link, Image), `diagrams` (Mermaid, draw.io, Table of Contents).

#### Scenario: All commands have a group
- **WHEN** the slash command list is defined
- **THEN** every command SHALL have a `group` value matching one of the defined groups

### Requirement: Grouped layout when browsing
When the slash menu is open with no query typed, commands SHALL be rendered under their group section headers in a fixed order: Basic, Insert, Diagrams.

#### Scenario: Menu opens with no query
- **WHEN** user types `/` and no further characters
- **THEN** the menu SHALL display commands organized under group headers in order: Basic, Insert, Diagrams

#### Scenario: Group header appearance
- **WHEN** a group header is rendered
- **THEN** it SHALL be non-interactive (not selectable, not focusable) and styled as small muted uppercase text

### Requirement: Flat layout when filtering
When the user has typed a query after `/`, the menu SHALL display matching commands as a flat list without group headers.

#### Scenario: User types a query
- **WHEN** user types `/ta`
- **THEN** matching commands SHALL be shown as a flat list without group section headers

### Requirement: Keyboard navigation skips group headers
Arrow key navigation SHALL only move between command items, never landing on group headers.

#### Scenario: Navigating past a group boundary
- **WHEN** user presses ArrowDown and the next command is in a different group
- **THEN** the selection SHALL move to that command, skipping the group header
