## Architecture

Frontend-only change. Two independent UI layers that both call existing TipTap table commands.

```
┌─────────────────────────────────────────────────────────┐
│ Editor.tsx                                              │
│                                                         │
│  ┌──────────────────────┐   ┌────────────────────────┐  │
│  │ Context Menu Layer   │   │ Hover Controls Layer   │  │
│  │                      │   │                        │  │
│  │ Right-click in cell  │   │ TableControls.tsx      │  │
│  │ → show table items   │   │ React overlay          │  │
│  │ in existing menu     │   │ → "+" at bottom/right  │  │
│  └──────────┬───────────┘   └───────────┬────────────┘  │
│             │                           │               │
│             ▼                           ▼               │
│  ┌──────────────────────────────────────────────────┐   │
│  │ TipTap Commands (already available)              │   │
│  │                                                  │   │
│  │ editor.chain().focus().addRowAfter().run()        │   │
│  │ editor.chain().focus().addColumnAfter().run()     │   │
│  │ editor.chain().focus().deleteRow().run()          │   │
│  │ editor.chain().focus().deleteColumn().run()       │   │
│  │ editor.chain().focus().deleteTable().run()        │   │
│  └──────────────────────────────────────────────────┘   │
│             │                                           │
│             ▼                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │ TableWithMarkdown serializer                     │   │
│  │ (existing — unchanged)                           │   │
│  │ → valid pipe-style markdown                      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Design Decisions

### Context menu: extend existing, don't create a separate one

The editor already has a context menu with Cut/Copy/Paste/Add Comment. When the cursor is inside a table, table items are appended after a separator. This avoids two competing right-click menus and keeps the interaction consistent.

Detection: `editor.isActive('table')` at the time the menu is built.

### ContextMenu separator support

The `ContextMenu` component currently only supports `{ label, action }` items. Add support for a `separator` item type (e.g., `{ type: 'separator' }`) rendered as an `<hr>` or a thin divider line. This keeps clipboard actions visually distinct from table actions.

### Hover controls: React overlay, not ProseMirror decorations

A React component (`TableControls`) renders absolutely-positioned "+" buttons relative to the hovered table's DOM bounding rect. This is simpler to style and maintain than ProseMirror widget decorations, and consistent with the app's React-first patterns.

The component:
1. Listens to `mouseover`/`mouseout` on the editor DOM to detect when the mouse enters/leaves a `<table>` element
2. When hovering a table, reads its `getBoundingClientRect()`
3. Renders two "+" buttons: one centered below the table (add row), one centered to the right (add column)
4. On click, resolves the ProseMirror position inside that table and dispatches the corresponding TipTap command

### Position resolution for hover buttons

The "+" buttons are outside any cell, so we need to place the cursor inside the table before calling a command. Strategy:
- **Add row**: set selection to the last cell of the last row, then `addRowAfter()`
- **Add column**: set selection to the last cell of the first row, then `addColumnAfter()`

This ensures the row/column is appended at the end, which matches the visual position of the "+" button.

### Edge case: deleting the last data row

When a table has only a header row and one data row, deleting that row would leave a header-only table. This is valid markdown but produces a weird editing experience (you can't navigate into it). The delete row action should be disabled / not shown when there is only one data row remaining.

### Edge case: single-column table

Deleting the last column should delete the entire table instead. TipTap's `deleteColumn` already handles this — it removes the table when the last column is deleted.

### No column alignment in this change

Column alignment (`:---`, `:---:`, `---:`) would require extending the `TableWithMarkdown` serializer and adding alignment attributes to cells. This is a separate, additive change that can be done later. The current serializer always writes `| --- |` (left-aligned).
