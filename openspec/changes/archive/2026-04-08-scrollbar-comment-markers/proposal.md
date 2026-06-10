## Why

In long documents with many comments, users have no way to know where unresolved comments are without scrolling through the entire document or opening the comments panel and clicking through each one. A visual indicator on the scrollbar area — similar to what VS Code does for search results — gives an instant spatial overview of where open conversations live, and highlights which ones mention you.

## What Changes

- Add a thin gutter strip alongside the scrollbar in the editor that displays colored pill markers for each unresolved comment thread
- Two visual tiers: regular unresolved comments (soft rose) and comments that `@mention` the current user (strong rose)
- Clicking a pill navigates the editor to that comment's position
- The gutter only renders when the document is tall enough to produce a scrollbar
- No hover tooltip or additional chrome — markers only

## Capabilities

### New Capabilities
- `scrollbar-comment-markers`: Visual pill markers in a gutter strip next to the editor scrollbar showing the position of unresolved comment threads, with emphasis on threads mentioning the current user

### Modified Capabilities
<!-- No existing spec-level requirements are changing. The comments system, editor, and navigation all stay the same — this is a new read-only visual overlay that consumes existing data. -->

## Impact

- **Frontend only** — no backend or API changes
- `packages/frontend/src/editor/Editor.tsx` — new component rendered inside `.editor-container`, new `currentUser` prop threaded through
- `packages/frontend/src/styles.css` — new CSS block for gutter strip and pill markers
- New file: `packages/frontend/src/editor/CommentScrollMarkers.tsx` (or similar)
- Depends on existing: `CommentThread[]` prop, `editor.view.coordsAtPos()`, `navigateToComment()` on `EditorHandle`, `extractMentions()` from shared package
