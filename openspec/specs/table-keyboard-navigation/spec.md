## Purpose

Keyboard navigation inside editor tables (Enter, Tab, arrow keys) for cell-to-cell movement.

## Requirements

### Requirement: Enter navigates to cell below
The editor SHALL move the cursor to the cell directly below (same column) when the user presses Enter inside a table cell.

#### Scenario: Enter in a middle row
- **WHEN** the cursor is in a table cell that is not in the last row
- **THEN** the cursor moves to the cell in the same column of the next row

#### Scenario: Enter in the header row
- **WHEN** the cursor is in a table header cell
- **THEN** the cursor moves to the cell in the same column of the first data row

#### Scenario: Enter in the last row
- **WHEN** the cursor is in a table cell in the last row
- **THEN** a new empty row is inserted below, and the cursor moves to the new cell in the same column

#### Scenario: Enter outside a table
- **WHEN** the cursor is not inside a table
- **THEN** the default Enter behavior (new paragraph) is preserved

### Requirement: Shift+Enter inserts line break in cell
The editor SHALL insert a hard break (line break) within the current table cell when the user presses Shift+Enter.

#### Scenario: Shift+Enter in a table cell
- **WHEN** the cursor is in a table cell and the user presses Shift+Enter
- **THEN** a hard break is inserted at the cursor position within the same cell

#### Scenario: Shift+Enter outside a table
- **WHEN** the cursor is not inside a table
- **THEN** the default Shift+Enter behavior is preserved

### Requirement: Tab navigation unchanged
The editor SHALL preserve existing Tab and Shift+Tab behavior for left-right cell navigation.

#### Scenario: Tab moves to next cell
- **WHEN** the cursor is in a table cell and the user presses Tab
- **THEN** the cursor moves to the next cell (left-to-right, wrapping to next row)

#### Scenario: Tab at last cell adds row
- **WHEN** the cursor is in the last cell of the table and the user presses Tab
- **THEN** a new row is added and the cursor moves to its first cell
