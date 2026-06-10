## Purpose

Expands remote text replacements to full table rows so collaborative edits do not corrupt table structure.

## Requirements

### Requirement: Table-aware diff expansion
When `applyRemoteMarkdown()` computes a diff region that falls inside a table node, the system SHALL expand the replacement bounds to cover the entire table node in both old and new documents before calling `tr.replace()`.

#### Scenario: Simple text edit inside a table cell
- **WHEN** a remote edit changes text content inside a single table cell
- **THEN** the replacement bounds are expanded to the full table node boundaries and the entire old table is replaced with the entire new table

#### Scenario: Edit spanning multiple table cells
- **WHEN** a remote edit produces a diff region that spans across multiple cells in a table
- **THEN** the replacement bounds are expanded to the full table node boundaries, avoiding cross-cell slices

#### Scenario: Edit outside a table
- **WHEN** a remote edit changes content in a paragraph or other non-table node
- **THEN** the existing surgical `tr.replace()` behavior is used unchanged (no expansion)

#### Scenario: Edit affecting both table and non-table content
- **WHEN** a remote edit produces a diff region where `start` falls inside a table node
- **THEN** the `start` position is expanded back to the table's start boundary and the replacement covers the full table plus any following content in the diff

### Requirement: Remote transactions excluded from undo history
Remote transactions dispatched by `applyRemoteMarkdown()` SHALL set `addToHistory: false` so they do not appear in the observer's undo stack.

#### Scenario: Observer presses undo after receiving remote edits
- **WHEN** the observer presses Ctrl+Z after remote edits have been applied
- **THEN** only the observer's own local edits are undone; remote edits are not affected
