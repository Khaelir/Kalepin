## Context

The TipTap editor uses a custom `TableWithMarkdown` extension that wraps `@tiptap/extension-table`. A recent fix (commit `42e00a3`) remapped Enter to insert a hard break instead of a new paragraph, preserving markdown serialization. However, this left no keyboard shortcut for row navigation or insertion — a gap compared to every major table editor (Sheets, Excel, Notion, Obsidian).

The current keybinding surface in tables:
- `Enter` → `editor.commands.setHardBreak()` (line break in cell)
- `Tab` / `Shift+Tab` → `goToNextCell()` / `goToPreviousCell()` (TipTap defaults)

## Goals / Non-Goals

**Goals:**
- Enter navigates to the cell below (same column), adding a row if on the last row
- Shift+Enter inserts a hard break in the current cell
- Match the mental model of Google Sheets / Excel / Notion

**Non-Goals:**
- Column insertion shortcuts
- Table toolbar or context menu for row/column operations
- Changes to markdown serialization logic
- Cell selection (multi-cell highlight) — remains handled by TipTap defaults

## Decisions

### 1. Use `prosemirror-tables` `TableMap` for cell resolution

**Choice**: Resolve the current cell's row/column position using `TableMap` from `prosemirror-tables`, then compute the target cell position for "move down."

**Alternatives considered**:
- **`goToNextCell()` called N times**: Hacky, fragile with varying column counts, wrong mental model.
- **Walk the ProseMirror document tree manually**: Possible but reinvents what `TableMap` already provides.

**Rationale**: `TableMap` is the canonical API for table position arithmetic in ProseMirror. It's already a transitive dependency via `@tiptap/extension-table`, so no new dependency. It gives us `positionAt(row, col)` which is exactly what we need.

### 2. Enter on last row adds a row, then navigates

**Choice**: When Enter is pressed on the last row, call `addRowAfter()` then navigate to the new cell below.

**Alternative**: Only navigate, never insert — require Tab at last cell to add rows.

**Rationale**: Sheets and Excel both add a row when you press Enter on the last row. This is the expected behavior. Tab-to-add is kept as a secondary path (TipTap default).

### 3. Keep all logic in `TableWithMarkdown.addKeyboardShortcuts()`

**Choice**: Both `Enter` and `Shift-Enter` handlers live in the existing `addKeyboardShortcuts()` override in `TableWithMarkdown`.

**Rationale**: Single location, easy to reason about. No need for a separate extension or plugin — the logic is ~30 lines.

## Risks / Trade-offs

- **[Risk] `prosemirror-tables` import may need explicit install** → Check if it's already resolvable from `node_modules`. If not, add as a direct dev dependency. It's already used transitively, so no version conflict risk.
- **[Risk] `addRowAfter()` + navigate is two transactions** → Could cause a flash. Mitigation: chain both operations in a single `editor.chain()` call if possible, or use a raw ProseMirror transaction.
- **[Trade-off] Enter always navigates down, even mid-text** → This matches Sheets (Enter = "done with cell") but differs from prose editors. Acceptable since tables are structured data, not prose.
