## 1. Create `CommentReplyEditor` component

- [x] 1.1 Create `CommentReplyEditor.tsx` in `packages/frontend/src/components/` with a minimal `useEditor()` setup: extensions = `[Document, Paragraph, Text, MentionNode, Placeholder, MentionMenuExtension]`
- [x] 1.2 Wire `createMentionMenuPlugin` via a local `MentionMenuExtension` (same 5-line pattern as in `Editor.tsx`) with a `useState` callback for menu state
- [x] 1.3 Render `<EditorContent />` + `<MentionAutocompleteMenu />` (when menu is active), calling `selectMentionUser(editor.view, user)` on selection
- [x] 1.4 Add Reply and Cancel buttons below the editor. Reply calls `serialize()` then `props.onSubmit(text)`. Cancel calls `props.onCancel()`.
- [x] 1.5 Implement `serialize(doc)`: walk `doc.content` recursively -- text nodes emit `.text`, mention nodes emit `@[displayName](email)`, paragraphs after the first emit `\n`. Return the concatenated string.
- [x] 1.6 Block submit when editor content is empty or whitespace-only (trim serialized output)
- [x] 1.7 Focus the editor on mount using `editor.commands.focus()` in a `useEffect` (wrap in `requestAnimationFrame` if needed)

## 2. Integrate into `CommentsPanel`

- [x] 2.1 Replace the reply `<textarea>` block (lines 182-206) with `<CommentReplyEditor onSubmit={...} onCancel={...} placeholder="Write a reply..." />`
- [x] 2.2 Remove all textarea mention state: `mentionState` useState, `replyRef`, `replyText`, `handleReplyChange`, `handleReplyKeyDown`, `handleMentionSelect`, `handleMentionDismiss`
- [x] 2.3 Remove the `getMentionState()` function
- [x] 2.4 Remove the `MentionAutocomplete` import and its usage in the JSX

## 3. Style the reply editor

- [x] 3.1 Add CSS for `.comment-reply-editor` to match the current textarea appearance: same background, border, border-radius, padding, font size
- [x] 3.2 Set `min-height` (~60px) and `max-height` (~150px) with `overflow-y: auto` for scroll on long replies
- [x] 3.3 Ensure the editor's `contenteditable` div has no default ProseMirror margins/padding that would misalign it
- [x] 3.4 Verify mention pills inside the editor use the existing `.mention-badge` / `.mention-badge-text` styles from `MentionNodeView`

## 4. Cleanup dead code

- [ ] 4.1 ~~Delete `MentionAutocomplete.tsx`~~ — **KEPT**: still used by `FloatingInput.tsx`
- [x] 4.2 Verify no other imports reference `MentionAutocomplete` -- FloatingInput.tsx still uses it, so component is retained

## 5. Test

- [x] 5.1 E2E test: open reply, type `@`, verify autocomplete dropdown appears with correct positioning
- [x] 5.2 E2E test: select a user, verify pill renders inline with correct color
- [x] 5.3 E2E test: type text + mention + text, click Reply, verify the submitted comment shows correctly with pills in `renderCommentText()`
- [x] 5.4 E2E test: backspace into a mention pill, verify it deletes atomically
- [x] 5.5 E2E test: paste rich text, verify only plain text is kept
- [x] 5.6 E2E test: click Cancel, reopen Reply, verify editor is fresh (no stale content)
- [x] 5.7 E2E test: verify focus lands in the editor when Reply is clicked
