## Context

Kalepin is a collaborative markdown editor built with React + TipTap (ProseMirror-based WYSIWYG) on the frontend and NestJS on the backend. The editor currently operates only in WYSIWYG mode with no way to view or edit raw Markdown. A generic `ContextMenu` component exists for the file tree but not for the editor. The sidebar file tree already uses `onClick` for single-click file opening — this needs verification that no competing behavior (e.g., tab preview vs permanent open) interferes.

Key files:
- `packages/frontend/src/editor/Editor.tsx` — TipTap editor wrapper
- `packages/frontend/src/components/FileTree.tsx` — sidebar file tree
- `packages/frontend/src/components/ContextMenu.tsx` — reusable context menu component
- `packages/frontend/src/editor/slash-commands.ts` — slash command system
- `packages/frontend/src/editor/ot-bridge.ts` — OT ↔ TipTap bridge

## Goals / Non-Goals

**Goals:**
- Files open immediately on single click from the sidebar (verify and fix if needed)
- Editor opens in rendered (WYSIWYG) mode by default, with a toggle to switch to raw Markdown view
- Right-click in the editor shows a context menu with Cut/Copy/Paste and "Add Comment"
- Reuse existing `ContextMenu` component for the editor context menu

**Non-Goals:**
- Live split-pane preview (side-by-side rendered + raw) — only one mode visible at a time
- WYSIWYG editing in raw Markdown mode — raw mode is plain text only
- Collaborative cursors in raw Markdown mode — OT sync pauses or converts in raw mode
- Backend changes — all work is frontend-only

## Decisions

### 1. Editor mode toggle: State in Editor component with serialization

**Decision**: Add a `mode` state (`'rendered' | 'raw'`) to `KalepinEditor`. When switching to raw mode, serialize the TipTap document to Markdown text and display in a `<textarea>`. When switching back, parse the Markdown and reload TipTap.

**Rationale**: This is the simplest approach. TipTap's internal document model is ProseMirror JSON, not Markdown, so we need explicit serialization/deserialization at mode boundaries. Using a `<textarea>` for raw mode avoids loading a second editor library.

**Alternative considered**: Using CodeMirror for raw mode — rejected as it adds a heavy dependency for what is essentially a plain text view. Can be added later if syntax highlighting is desired.

**Serialization**: Use `@tiptap/pm/model` to serialize ProseMirror doc → Markdown string. A lightweight custom serializer or a library like `prosemirror-markdown` / `tiptap-markdown` can handle this.

### 2. OT handling during mode switch

**Decision**: When switching modes, flush any pending OT operations. In raw mode, local edits are buffered and converted to OT ops only when switching back to rendered mode (or on save). Remote OT ops received during raw mode are queued and applied on mode switch back.

**Rationale**: The OT bridge (`ot-bridge.ts`) works with ProseMirror transactions. Raw textarea edits don't produce ProseMirror transactions, so we need a different sync strategy. Buffering is the simplest correct approach.

**Trade-off**: Other users' edits won't appear in real-time while in raw mode. This is acceptable since raw mode is an advanced/escape-hatch feature.

### 3. Editor context menu: Reuse existing ContextMenu component

**Decision**: Attach an `onContextMenu` handler to the editor container div. Build menu items dynamically based on selection state (e.g., show "Add Comment" only when text is selected). Reuse the existing `ContextMenu` component from `components/ContextMenu.tsx`.

**Rationale**: The `ContextMenu` component is already generic (takes `{label, action}[]`). No need to create a new component.

**Clipboard actions**: Use `document.execCommand('copy')` / `document.execCommand('cut')` / `document.execCommand('paste')` or the Clipboard API (`navigator.clipboard`). TipTap/ProseMirror handles clipboard operations natively, so the context menu actions just need to trigger the same commands.

### 4. "Add Comment" flow

**Decision**: When "Add Comment" is clicked, capture the current text selection, create a comment thread via the existing comments API (`POST /api/comments`), and mark the selected text with a decoration or mark in the editor.

**Rationale**: The comments system already exists with a full CRUD API and sidecar YAML storage. The frontend already has a comments sidebar panel. This just adds a new entry point to create comments from selected text.

### 5. Mode toggle UI placement

**Decision**: Place the mode toggle (a small segmented control or icon buttons) in the editor header area, above the editor content. Labels: a rendered/preview icon and a code/raw icon.

**Rationale**: Keeps the toggle visible but unobtrusive. Similar to how VS Code and other editors place view mode toggles.

## Risks / Trade-offs

- **Markdown serialization fidelity**: Converting TipTap ProseMirror doc → Markdown → back may lose some formatting nuances (e.g., specific HTML attributes). → Mitigation: Use a well-tested serializer; accept minor formatting normalization.
- **OT sync gap in raw mode**: Other users' changes won't reflect in real-time during raw mode. → Mitigation: Show a visual indicator that sync is paused; auto-switch back to rendered mode if conflicts are detected.
- **Clipboard API permissions**: `navigator.clipboard.readText()` requires user permission in some browsers. → Mitigation: Fall back to `document.execCommand` and handle permission denial gracefully.
