## Why

Table cells currently use Enter for hard breaks (line breaks within a cell), but there is no keyboard shortcut to add or navigate between rows. This fights the universal convention from Google Sheets, Excel, Notion, and Obsidian where Enter is the structural/navigation action and Shift+Enter is the inline action. Users expect Enter to move down a row, not insert a line break.

## What Changes

- **Enter in table**: Navigates to the cell below in the same column. If on the last row, inserts a new row first, then navigates to it.
- **Shift+Enter in table**: Inserts a hard break (`<br>`) within the current cell — the behavior that Enter has today.
- Tab/Shift+Tab behavior remains unchanged (left-right cell navigation).
- No changes to markdown serialization.

## Capabilities

### New Capabilities
- `table-keyboard-navigation`: Keyboard shortcuts for navigating between table rows and inserting line breaks within cells, following spreadsheet conventions.

### Modified Capabilities

_(none — this is a keybinding change within the existing editor capability, not a spec-level requirement change)_

## Impact

- **Code**: `packages/frontend/src/editor/Editor.tsx` — `TableWithMarkdown` extension's `addKeyboardShortcuts()` method.
- **Dependencies**: `prosemirror-tables` (already a transitive dependency via `@tiptap/extension-table`) for `TableMap` cell resolution. `prosemirror-state` for `TextSelection`.
- **No backend changes**.
- **No serialization changes** — tables continue to emit standard pipe-delimited markdown.
