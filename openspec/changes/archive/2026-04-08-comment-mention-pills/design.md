## Context

Comment replies use a plain `<textarea>` in `CommentsPanel.tsx`. When a user types `@` and selects a person from the `MentionAutocomplete` dropdown, the mention is inserted as raw markdown: `@[j.doe](j.doe@example.com)`. This is only rendered as a styled pill after submission, via `renderCommentText()`.

Meanwhile, the document editor already has a full inline mention system: `MentionNode` (TipTap extension), `MentionNodeView` (colored pill renderer), `createMentionMenuPlugin` (@ detection + keyboard handling + insertion), and `MentionAutocompleteMenu` (dropdown UI). All of these work on any TipTap/ProseMirror editor instance -- they have no coupling to the main document editor.

## Goals / Non-Goals

**Goals:**
- Mentions render as styled pills immediately upon selection in the reply box
- Reuse the existing editor mention machinery (no new autocomplete logic)
- Keep the stored format unchanged (`@[name](email)` markdown in comment text)
- Net code reduction by removing the bespoke textarea mention wiring

**Non-Goals:**
- Rich text formatting in comments (bold, italic, links, etc.)
- Mention pills in the "new comment" flow (only reply inputs for now -- can extend later)
- Changing the backend comment API or storage format
- Enter-to-submit (keep the Reply button as the submit mechanism)

## Decisions

### D1: Minimal TipTap editor for comment replies

**Choice:** Replace the reply `<textarea>` with a `useEditor()` instance configured with only: `Document`, `Paragraph`, `Text`, `MentionNode`, `Placeholder`, and the mention autocomplete plugin.

**Rationale:** TipTap is already fully loaded in the bundle. A minimal extension set means the editor behaves like a plain text input that happens to support mention nodes. No toolbar, no formatting commands -- the `contenteditable` div looks and feels like a textarea but renders mention pills inline.

**Alternatives considered:**
- Overlay trick (transparent textarea + styled mirror div): Fragile pixel alignment, cursor mismatch, breaks on resize/zoom. Abandoned early in exploration.
- Lightweight contenteditable libraries (Lexical, Slate): Adds a new dependency when TipTap is already available with all needed extensions. No benefit.

### D2: New `CommentReplyEditor` component

**Choice:** Extract the mini editor into a dedicated `CommentReplyEditor` component rather than inlining the `useEditor()` setup inside `CommentsPanel.tsx`.

**Rationale:** `CommentsPanel` is already 230 lines. The editor setup (extensions, serialization, autocomplete wiring, focus management) is a cohesive unit that benefits from isolation. The component exposes a simple interface:

```
┌─ CommentReplyEditor ──────────────────────────────┐
│                                                    │
│  Props:                                            │
│    onSubmit: (text: string) => void                │
│    onCancel: () => void                            │
│    placeholder?: string                            │
│                                                    │
│  Internal:                                         │
│    useEditor({ extensions: [...] })                │
│    mentionMenuState (from plugin callback)         │
│    serialize() → "@[name](email) plain text"       │
│                                                    │
│  Renders:                                          │
│    <EditorContent />                               │
│    <MentionAutocompleteMenu /> (when active)       │
│    <div class="reply-actions">                     │
│      <button>Reply</button>                        │
│      <button>Cancel</button>                       │
│    </div>                                          │
│                                                    │
└────────────────────────────────────────────────────┘
```

### D3: Serialize TipTap doc to mention markdown on submit

**Choice:** On submit, walk the ProseMirror document and produce the same `@[name](email)` markdown format stored today. The serializer handles two node types:
- **Text nodes**: emit their text content as-is
- **Mention nodes**: emit `@[displayName](email)`

```
TipTap doc                          Serialized string
┌─────────────────────────┐        ┌──────────────────────────────────┐
│ Text("hello ")          │        │                                  │
│ Mention({email: "a@b"}) │  ──▶   │ "hello @[a](a@b) what do you     │
│ Text(" what do you      │        │  think?"                         │
│  think?")               │        │                                  │
└─────────────────────────┘        └──────────────────────────────────┘
```

**Rationale:** The backend, notification system, and `renderCommentText()` in existing submitted comments all depend on the `@[name](email)` regex format. Changing the storage format would cascade across the stack for zero benefit.

**Note:** The display name in the mention node comes from `UserInfo.displayName` (or email local part as fallback) -- the same logic already used in `MentionNodeView` and the old `handleMentionSelect`.

### D4: Reuse `createMentionMenuPlugin` and `MentionAutocompleteMenu` as-is

**Choice:** Use the exact same plugin and dropdown component from the document editor. The plugin is instantiated per-editor via the extension wrapper pattern:

```typescript
const MentionMenuExtension = Extension.create({
  name: 'mentionMenu',
  addProseMirrorPlugins() {
    return [createMentionMenuPlugin(setMentionMenu)];
  },
});
```

**Rationale:** The plugin has no coupling to the main editor. It uses `coordsAtPos` for positioning (works in any ProseMirror view), checks `editable` state, and communicates via a callback. The `MentionAutocompleteMenu` component is a pure function of `MentionMenuState` + an `onSelect` callback. Both are fully reusable.

### D5: Focus management via `editor.commands.focus()`

**Choice:** When the reply form opens (user clicks "Reply"), call `editor.commands.focus()` in a `useEffect` triggered by the editor being ready. This replaces the textarea's `autoFocus` attribute.

**Rationale:** `autoFocus` doesn't work on contenteditable. TipTap's `.focus()` command is the standard approach and handles cross-browser differences. Wrapping in `requestAnimationFrame` may be needed if the DOM isn't ready on first render -- same pattern used elsewhere in the codebase.

### D6: Delete `MentionAutocomplete` component

**Choice:** Remove `MentionAutocomplete.tsx` entirely after migration.

**Rationale:** This component was purpose-built for the textarea mention flow. It duplicates logic that exists in `createMentionMenuPlugin` (keyboard handling, filtering, positioning) and `MentionAutocompleteMenu` (rendering). After the switch, nothing references it.

## Risks / Trade-offs

**[contenteditable focus quirks]** Some browsers may not reliably focus a contenteditable element on first render, especially inside a dynamically shown container. **Mitigation:** Use `requestAnimationFrame` + `editor.commands.focus()`. Test on Chrome, Firefox, Safari.

**[Paste behavior differs from textarea]** Pasting into TipTap may include formatting from the clipboard (if the source is rich text). **Mitigation:** The minimal extension set (no bold, italic, etc.) means TipTap strips formatting automatically -- only plain text and existing mention nodes survive paste. Verify with a quick test.

**[Height auto-sizing]** The textarea may have had explicit height/resize behavior. TipTap's `EditorContent` grows naturally with content. **Mitigation:** CSS `min-height` + `max-height` with `overflow-y: auto` on the editor wrapper gives the same behavior.
