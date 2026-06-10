## ADDED Requirements

### Requirement: Right-click context menu shows table actions
When the cursor is inside a table cell and the user right-clicks, the editor context menu SHALL include table-specific actions separated from the standard clipboard actions by a visual divider.

#### Scenario: Right-click in a table cell
- **WHEN** the user right-clicks inside a table cell (header or data)
- **THEN** the context menu shows: Cut, Copy, Paste, [separator], Insert row above, Insert row below, Insert column left, Insert column right, [separator], Delete row, Delete column, Delete table

#### Scenario: Right-click outside a table
- **WHEN** the user right-clicks outside any table
- **THEN** the context menu shows only the standard items (Cut, Copy, Paste, and optionally Add Comment) — no table actions

#### Scenario: Insert row above
- **WHEN** the user clicks "Insert row above" in the context menu
- **THEN** a new empty row is inserted above the current row and the cursor moves to it
- **THEN** the markdown output contains the new row in the correct position

#### Scenario: Insert row below
- **WHEN** the user clicks "Insert row below" in the context menu
- **THEN** a new empty row is inserted below the current row and the cursor moves to it

#### Scenario: Insert column left
- **WHEN** the user clicks "Insert column left" in the context menu
- **THEN** a new empty column is inserted to the left of the current column
- **THEN** all rows (including header and delimiter) gain the new column in markdown

#### Scenario: Insert column right
- **WHEN** the user clicks "Insert column right" in the context menu
- **THEN** a new empty column is inserted to the right of the current column

#### Scenario: Delete row
- **WHEN** the user clicks "Delete row" in the context menu
- **THEN** the current row is removed and the cursor moves to an adjacent row

#### Scenario: Delete row disabled on last data row
- **WHEN** the table has only one data row (plus the header row) and the cursor is in that data row
- **THEN** the "Delete row" action is disabled or hidden

#### Scenario: Delete row in header
- **WHEN** the cursor is in the header row and the user clicks "Delete row"
- **THEN** the action is disabled or hidden (header row cannot be deleted in markdown tables)

#### Scenario: Delete column
- **WHEN** the user clicks "Delete column" in the context menu
- **THEN** the current column is removed from all rows

#### Scenario: Delete last column removes table
- **WHEN** the table has only one column and the user clicks "Delete column"
- **THEN** the entire table is removed

#### Scenario: Delete table
- **WHEN** the user clicks "Delete table" in the context menu
- **THEN** the entire table is removed and the cursor moves to the position where the table was

### Requirement: Hover "+" buttons to append rows and columns
When the user hovers over a table, "+" buttons SHALL appear at the bottom and right edges to allow quick row and column insertion.

#### Scenario: Hover over table shows "+" buttons
- **WHEN** the user moves the mouse over a table in the editor
- **THEN** a "+" button appears centered below the bottom edge of the table
- **THEN** a "+" button appears centered to the right of the right edge of the table

#### Scenario: Mouse leaves table hides "+" buttons
- **WHEN** the user moves the mouse away from the table and the "+" buttons
- **THEN** the "+" buttons disappear

#### Scenario: Click bottom "+" adds row
- **WHEN** the user clicks the "+" button below the table
- **THEN** a new empty row is appended as the last data row of the table

#### Scenario: Click right "+" adds column
- **WHEN** the user clicks the "+" button to the right of the table
- **THEN** a new empty column is appended as the last column of the table

#### Scenario: "+" buttons do not appear in raw mode
- **WHEN** the editor is in raw markdown mode
- **THEN** no "+" buttons are shown on table hover

### Requirement: Context menu supports visual separators
The ContextMenu component SHALL support separator items that render as visual dividers between groups of actions.

#### Scenario: Separator renders as divider
- **WHEN** the context menu items list contains a separator item
- **THEN** a horizontal divider line is rendered at that position (not clickable)

## MODIFIED Requirements

### Requirement: Right-click in editor opens context menu (from editor-context-menu)
*Extended to include table-specific items when cursor is inside a table. Base behavior unchanged.*
