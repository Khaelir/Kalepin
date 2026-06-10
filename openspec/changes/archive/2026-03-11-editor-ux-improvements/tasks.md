## 1. Sidebar Single-Click Verification

- [x] 1.1 Verify that FileTree.tsx single-click behavior works correctly end-to-end (no competing double-click or preview-only-on-first-click behavior in App.tsx)
- [x] 1.2 Fix any issues found — ensure single click immediately opens and loads the file in the editor

## 2. Markdown Serialization

- [x] 2.1 Add a TipTap-to-Markdown serializer (install `tiptap-markdown` or implement a lightweight ProseMirror-to-Markdown converter)
- [x] 2.2 Add a Markdown-to-TipTap parser (reverse direction: parse raw Markdown string back into TipTap/ProseMirror document)
- [x] 2.3 Write tests or manual verification for round-trip fidelity (rendered → raw → rendered preserves content)

## 3. Editor Mode Toggle

- [x] 3.1 Add `mode` state (`'rendered' | 'raw'`) to `KalepinEditor` component
- [x] 3.2 Create the mode toggle UI control (segmented control or icon buttons) in the editor header area
- [x] 3.3 Implement raw Markdown view: render a `<textarea>` with the serialized Markdown content when in raw mode, hide TipTap
- [x] 3.4 Implement mode switch logic: serialize TipTap → Markdown on switch to raw; parse Markdown → TipTap on switch to rendered
- [x] 3.5 Disable slash commands in raw mode (slash menu should not activate in the textarea)
- [x] 3.6 Style the mode toggle and raw textarea to match the existing editor aesthetics

## 4. OT Sync Across Modes

- [x] 4.1 Flush pending OT operations before switching modes
- [x] 4.2 Queue remote OT operations received while in raw mode
- [x] 4.3 Apply queued remote operations when switching back to rendered mode
- [x] 4.4 Add a visual indicator in raw mode that real-time sync is paused

## 5. Editor Context Menu

- [x] 5.1 Add `onContextMenu` handler to the editor container div in `Editor.tsx` (suppress browser default)
- [x] 5.2 Show the existing `ContextMenu` component with Cut, Copy, Paste items
- [x] 5.3 Implement clipboard actions using Clipboard API / `document.execCommand` fallback
- [x] 5.4 Conditionally show "Add Comment" menu item only when text is selected
- [x] 5.5 Implement "Add Comment" action: capture selection, call existing comments API (`POST /api/comments`), open comments sidebar
- [x] 5.6 Ensure custom context menu only appears in rendered mode (allow browser default in raw mode)

## 6. Integration & Polish

- [x] 6.1 Test full flow: open file → rendered mode → toggle to raw → edit → toggle back → verify content
- [x] 6.2 Test context menu: right-click → copy/paste → add comment on selection
- [x] 6.3 Verify OT sync works correctly when switching modes while collaborating
- [x] 6.4 Responsive styling and edge case handling (empty documents, large files)
