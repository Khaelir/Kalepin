## 1. Setup

- [x] 1.1 Verify `prosemirror-tables` is resolvable from `packages/frontend` (transitive dep via `@tiptap/extension-table`). If not, add as direct dependency.

## 2. Core Implementation

- [x] 2.1 Import `TableMap` from `prosemirror-tables` and `TextSelection` from `prosemirror-state` in `Editor.tsx`
- [x] 2.2 Implement Enter handler: resolve current cell's row/col via `TableMap`, navigate to cell below (same column). If on last row, `addRowAfter()` first, then navigate.
- [x] 2.3 Implement Shift+Enter handler: call `setHardBreak()` when inside a table (move existing Enter logic)
- [x] 2.4 Ensure Enter outside tables falls through to default behavior (`return false`)

## 3. Verification

- [x] 3.1 Test Enter in middle row moves cursor to cell below, same column
- [x] 3.2 Test Enter in last row adds a new row and moves cursor down
- [x] 3.3 Test Enter in header row moves to first data row
- [x] 3.4 Test Shift+Enter inserts hard break within cell
- [x] 3.5 Test Tab/Shift+Tab navigation is unaffected
- [x] 3.6 Test markdown serialization still produces valid pipe tables
