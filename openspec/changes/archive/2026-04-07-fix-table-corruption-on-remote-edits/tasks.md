## 1. Table-aware diff expansion

- [x] 1.1 In `applyRemoteMarkdown()`, after computing `start`/`endA`/`endB`, resolve `start` in the old doc and check if any ancestor is a `table` node. If so, expand `start` to the table's start position and `endA` to the table's end position.
- [x] 1.2 Find the corresponding table in the new doc (same logic: resolve `start` in `newDoc`, expand `endB` to the new table's end position).
- [x] 1.3 Handle edge case: if `endA` extends beyond the table (diff spans table + following content), keep `endA` as-is and only expand `start` backward to the table start.

## 2. Undo history fix

- [x] 2.1 Add `tr.setMeta('addToHistory', false)` before `editor.view.dispatch(tr)` in `applyRemoteMarkdown()`.

## 3. Verification

- [ ] 3.1 Test: open a note with a table in two browser tabs, type in a cell in tab A, verify table stays intact in tab B.
- [ ] 3.2 Test: in tab B press Ctrl+Z after receiving remote edits — should not undo remote changes.
- [ ] 3.3 Test: edit non-table content and verify the surgical replace still works (no regression).
