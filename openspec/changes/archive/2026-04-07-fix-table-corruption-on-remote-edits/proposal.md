## Why

When an observer watches another user edit inside a table, the table structure corrupts on the observer's side — cells merge wrong and subtables appear. The markdown/OT layer is correct (refreshing the page fixes it), but `applyRemoteMarkdown()` corrupts the ProseMirror document via `tr.replace()` with cross-cell slices. This is a production-visible bug affecting collaborative editing reliability.

## What Changes

- Detect when a remote diff region falls inside a table node and expand the replacement bounds to cover the entire table, avoiding cross-cell slices that corrupt structure
- Mark remote transactions with `addToHistory: false` so they don't pollute the observer's undo stack

## Capabilities

### New Capabilities
- `table-safe-remote-replace`: Table-aware replacement logic in `applyRemoteMarkdown()` that expands diff bounds to table node boundaries when the diff touches a table

### Modified Capabilities
- `ot-collaboration`: Remote transactions now set `addToHistory: false` to prevent undo stack pollution

## Impact

- `packages/frontend/src/editor/Editor.tsx` — `applyRemoteMarkdown()` function (lines 57-105)
- No API, dependency, or backend changes
- No breaking changes
