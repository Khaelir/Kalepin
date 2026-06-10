## Purpose

Keeps the slash command menu open on zero results and shows a helpful empty state.

## Requirements

### Requirement: Menu stays open on zero results
When filtering produces zero matching commands, the slash menu SHALL remain open instead of closing.

#### Scenario: No matches found
- **WHEN** user types `/asdfg` and no commands match
- **THEN** the menu SHALL remain visible

### Requirement: Empty state message
When no commands match the query, the menu SHALL display a centered "No matching commands" message in muted text.

#### Scenario: Empty state content
- **WHEN** filtering produces zero results
- **THEN** the menu SHALL show "No matching commands" in the command list area

#### Scenario: Recovering from empty state
- **WHEN** the user backspaces to a query that matches commands
- **THEN** the matching commands SHALL replace the empty state message immediately

### Requirement: Menu dismissal still works in empty state
The user SHALL be able to close the menu via Escape key or clicking outside, even when in the empty state.

#### Scenario: Escape in empty state
- **WHEN** the menu shows "No matching commands" and user presses Escape
- **THEN** the menu SHALL close and the slash query text SHALL be removed from the editor
