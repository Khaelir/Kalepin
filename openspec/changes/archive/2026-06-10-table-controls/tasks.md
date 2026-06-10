## Tasks

- [x] Task 1: Add separator support to ContextMenu component
**File:** `packages/frontend/src/components/ContextMenu.tsx`

Update the `ContextMenuProps` items type to support a union:
- `{ label: string; action: () => void }` (existing)
- `{ type: 'separator' }` (new)

Render separator items as an `<hr>` or styled `<div>` with the `context-menu-separator` class. Add corresponding CSS in `styles.css`.

- [x] Task 2: Add table actions to editor context menu
**File:** `packages/frontend/src/editor/Editor.tsx`

In the `contextMenuItems` builder (~line 930), when `editor.isActive('table')`, append table-specific items after a separator:
- Insert row above → `editor.chain().focus().addRowBefore().run()`
- Insert row below → `editor.chain().focus().addRowAfter().run()`
- Insert column left → `editor.chain().focus().addColumnBefore().run()`
- Insert column right → `editor.chain().focus().addColumnAfter().run()`
- [separator]
- Delete row → `editor.chain().focus().deleteRow().run()` (disabled if header row or last data row)
- Delete column → `editor.chain().focus().deleteColumn().run()`
- Delete table → `editor.chain().focus().deleteTable().run()`

For "disabled" detection:
- Header row: check if the cell node type is `tableHeader`
- Last data row: count table rows, disable if only 2 (header + 1 data)

- [x] Task 3: Create TableControls hover overlay component
**File:** `packages/frontend/src/editor/TableControls.tsx` (new)

React component that:
1. Takes the editor instance and editor DOM element as props
2. Attaches `mouseover`/`mouseout` listeners on the editor DOM
3. When mouse enters a `<table>`, stores a ref to that table element
4. Reads `getBoundingClientRect()` to position two "+" buttons:
   - Bottom center: add row
   - Right center: add column
5. On button click:
   - Resolves a ProseMirror position inside the target table
   - Sets selection to the appropriate cell (last row last col for add-row, first row last col for add-col)
   - Calls `addRowAfter()` or `addColumnAfter()`
6. Buttons stay visible while mouse is over the table OR over the buttons themselves (use a short delay or a wrapper div that covers both)
7. Not rendered when editor mode is `raw`

- [x] Task 4: Integrate TableControls into Editor.tsx
**File:** `packages/frontend/src/editor/Editor.tsx`

Render `<TableControls>` inside the editor container, passing the editor instance. Only render when `mode === 'rendered'` and the editor is editable.

- [x] Task 5: Style the "+" buttons and context menu separator
**File:** `packages/frontend/src/styles.css`

- `.table-add-btn`: small circular or pill-shaped button, uses `var(--text-tertiary)` color, subtle border or background, hover highlight with `var(--accent)`, `z-index` above editor content
- `.table-add-btn:hover`: accent color fill/border
- `.context-menu-separator`: thin horizontal line using `var(--border)`, small vertical margin
- Buttons should feel consistent with the app's existing UI (no heavy shadows, no emoji icons — use a simple `+` character or a thin SVG)
