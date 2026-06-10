## Why

When mentioning a user in a comment reply, the mention appears as raw markdown (`@[j.doe](j.doe@example.com)`) while typing. It only renders as a styled pill after submission. This is jarring -- the input looks broken until you hit Reply. The document editor already shows mention pills inline while typing, so the comment box feels inconsistent by comparison.

## What Changes

- **Replace the reply `<textarea>` with a minimal TipTap editor** that reuses the existing `MentionNode` extension. Mentions render as colored pills immediately upon selection, matching the submitted-comment display.
- **Reuse the existing mention autocomplete plugin** (`createMentionMenuPlugin`) and dropdown (`MentionAutocompleteMenu`). No new autocomplete logic needed.
- **Serialize on submit**: When the user clicks Reply, walk the TipTap document and convert mention nodes back to `@[name](email)` markdown. The backend and stored format are unchanged.
- **Delete the textarea mention wiring**: `getMentionState()`, `handleReplyChange`, `handleMentionSelect`, the `MentionAutocomplete` component for comments, and all manual cursor/selection management are removed.

## Capabilities

### New Capabilities
- `comment-reply-editor`: A minimal TipTap editor component for comment replies. Extensions: Document, Paragraph, Text, MentionNode, Placeholder, and the mention autocomplete plugin. No toolbar, no formatting -- plain text with inline mention pills.

### Modified Capabilities
- `comments-panel`: The reply form swaps its `<textarea>` for the new `CommentReplyEditor`. The `onReply` callback receives the same `@[name](email)` markdown string as before -- no interface changes.

## Impact

- **Frontend only**. Backend, API, and stored comment format are completely unchanged.
- **No new dependencies**. All TipTap packages are already in the bundle (used by the document editor). Zero bundle size increase.
- **Net code reduction**. The manual mention state management in `CommentsPanel.tsx` (~70 lines) and the `MentionAutocomplete.tsx` component (~100 lines) are replaced by a ~80-line editor component plus a ~15-line serializer.
- **Reuses proven machinery**: `MentionNode`, `MentionNodeView`, `createMentionMenuPlugin`, and `MentionAutocompleteMenu` are all used as-is from the document editor.

## Risks

- **Focus management**: `contenteditable` focus can behave differently from textarea `autoFocus` across browsers. Needs manual testing on the Reply open/close flow.
- **Enter key**: TipTap defaults to Enter = new paragraph. This matches the current behavior (Reply button submits, not Enter). If we later want Enter-to-submit, it's a one-line `handleKeyDown` addition.
- **`MentionAutocomplete` component may be orphaned**: It was only used by the comment textarea. If nothing else uses it, it should be deleted to avoid dead code.

## Non-goals

- Rich text formatting in comments (bold, links, etc.). This change keeps comments as plain text + mentions only.
- Editing existing comments inline. Only the reply input is affected.
- Changing the mention markdown format or backend extraction logic.
