## Why

Tables are one of the most friction-heavy editing experiences in Kalepin. Users can create tables via `/table` and navigate with Tab/Enter, but there is no way to add a column, delete a row, or remove a column without editing raw markdown. TipTap already provides all the commands (`addRowBefore`, `addRowAfter`, `deleteRow`, `addColumnBefore`, `addColumnAfter`, `deleteColumn`, `deleteTable`) — they are just not exposed in the UI.

## What Changes

Two complementary layers of table controls:

1. **Right-click context menu** — When the cursor is inside a table cell, the existing editor context menu gains table-specific actions: insert row above/below, insert column left/right, delete row, delete column, delete table. These items appear in addition to the existing Cut/Copy/Paste items, separated by a visual divider.

2. **Hover "+" buttons** — When the user hovers over a table, small "+" buttons appear at the bottom edge (add row) and right edge (add column). These cover the most common operation ("I need one more row/column") with zero right-click friction.

All operations produce valid markdown pipe-style tables. No colspan, rowspan, or block content is introduced.

## Capabilities

### New Capabilities
- `table-controls`: Hover "+" buttons on table edges and right-click context menu with row/column insert/delete actions

### Modified Capabilities
- `editor-context-menu`: Adds table-specific items (insert/delete row/column, delete table) when cursor is inside a table cell

## Impact

- **Frontend only** — no backend changes
- **Editor.tsx**: Extend `contextMenuItems` to include table actions when `editor.isActive('table')`
- **New component**: `TableControls.tsx` — React overlay that positions "+" buttons relative to the hovered table DOM element
- **styles.css**: New styles for "+" buttons and context menu separator
- **ContextMenu.tsx**: Support separator items for visual grouping
- **No new dependencies**
