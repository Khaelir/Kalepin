## Context

`applyRemoteMarkdown()` in `Editor.tsx` (lines 57-105) applies incoming OT operations to the observer's editor. The pipeline:

1. Apply OT ops to the markdown shadow string
2. Parse the new markdown → HTML → ProseMirror doc
3. Diff the old and new PM docs via `findDiffStart`/`findDiffEnd`
4. Apply a surgical `tr.replace(start, endA, newDoc.slice(start, endB))`

Step 4 breaks tables because `findDiffStart`/`findDiffEnd` can produce a diff region that spans across table cell boundaries. The resulting `Slice` has `openStart`/`openEnd` depths that don't align with table structure, causing ProseMirror's replace algorithm to close/reopen nodes incorrectly — merging cells, splitting rows, etc. `fixTables()` (from `prosemirror-tables`) runs afterward via `appendTransaction` but can't recover from severe structural damage.

Additionally, remote transactions lack `addToHistory: false`, so observer undo stacks accumulate remote edits.

## Goals / Non-Goals

**Goals:**
- Prevent table structure corruption when applying remote edits to tables
- Keep remote edits out of the observer's undo history
- Preserve the existing surgical diff/replace approach for non-table content (it's efficient and works correctly there)

**Non-Goals:**
- Handling concurrent editing within the same table (both users typing in the same table simultaneously) — that's a broader problem
- Migrating to Yjs or a different collaboration protocol
- Fixing table editing commands themselves (addRow, mergeCell, etc.)

## Decisions

### 1. Expand diff bounds to table node boundaries when diff touches a table

After computing `start`/`endA`/`endB`, resolve `start` in the old doc to check if it falls inside a table node. If so, walk up the resolved position's ancestors to find the table node, then expand `start` to the table's start position and `endA`/`endB` to the table's end positions in the respective docs.

**Why this over alternatives:**
- **Alternative: Always replace whole doc** — too coarse, would disrupt cursor position and selection for all non-table edits
- **Alternative: Run `fixTables()` explicitly after replace** — it already runs via `appendTransaction` and doesn't recover from severe damage
- **Alternative: Use ProseMirror Steps instead of `tr.replace()`** — Steps have the same slicing problem; the issue is the slice content, not the API

**Implementation:** Use `oldDoc.resolve(start)` to get a `ResolvedPos`, walk `.node(depth)` from the resolved position upward checking for `node.type.name === 'table'`. If found, use the table's position boundaries. Do the same for the new doc to find the corresponding table boundaries.

### 2. Set `addToHistory: false` on remote transactions

Add `tr.setMeta('addToHistory', false)` before dispatching remote transactions. This is standard ProseMirror practice for programmatic edits.

**Why:** Remote edits should never be undoable by the observer. Currently pressing Ctrl+Z can undo someone else's edits, which is confusing.

## Risks / Trade-offs

- **[Risk] Observer cursor inside table jumps on remote edit** → Acceptable: cursor was already being corrupted by the broken replace. Whole-table replacement is strictly better. Future work could use `setSelection` to restore cursor position if needed.
- **[Risk] Slightly larger transaction for table edits** → Negligible: tables are small. Replacing a 20-row table vs one character is microseconds of DOM work.
- **[Risk] Two tables back-to-back with changes in both** → The table detection is per-position; if `start` is in table A and `endA` is in table B, we'd expand to cover both tables. This is correct behavior — replacing both tables is safer than cross-table surgery.
