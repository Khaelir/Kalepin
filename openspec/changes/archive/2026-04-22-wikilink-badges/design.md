## Context

Wikilinks (`[[...]]`) are currently stored as plain text in ProseMirror. A regex-based ProseMirror plugin detects `[[` before the cursor and triggers autocomplete. Navigation requires Cmd/Ctrl+Click, handled by a separate `LinkClickExtension` plugin that scans text around the click position for `[[...]]` brackets.

This architecture causes a bug: clicking inside an existing `[[...]]` link places the cursor there, and the autocomplete plugin sees `[[query` text before the cursor and fires. Selecting a suggestion corrupts the link.

The codebase uses `tiptap-markdown` for markdown↔ProseMirror conversion, keeping wikilinks as literal text in the document model. The existing `link-index` spec already defines rename-rewriting behavior (updating `[[old]]` → `[[new]]` in files on disk), and `rename-tracking` handles starred items and change history paths.

## Goals / Non-Goals

**Goals:**
- Wikilinks render as interactive pill/badge elements in the editor
- Single click navigates, double-click opens edit popover
- Visual distinction between valid, broken, and ambiguous links
- Autocomplete corruption bug eliminated by architecture (node, not text)
- File renames update wikilinks in open editor sessions via OT

**Non-Goals:**
- Heading rename tracking (matches Obsidian — headings break silently)
- Auto-creating notes on broken link click (user chose option 2: visual distinction only)
- Alias editing UI (aliases like `[[Page|display text]]` are preserved but not given a dedicated edit flow yet)
- Changes to the BacklinksPanel component (it queries the backend index, unaffected by frontend node changes)

## Decisions

### D1: TipTap inline node with React NodeView

**Decision**: Implement wikilinks as a custom TipTap `Node.create()` inline node with `atom: true` and a React NodeView for rendering.

**Alternatives considered:**
- *ProseMirror decorations (Obsidian-style live preview)*: Would avoid schema changes, but cursor management for expanding/collapsing brackets is complex, click handling is ambiguous (place cursor vs navigate), and the autocomplete bug isn't fully eliminated since the underlying text still matches the regex.
- *TipTap Mark (instead of Node)*: Marks wrap existing text but don't create atomic units — the badge wouldn't behave as a single deletable entity, and cursor navigation would still move through the text.

**Rationale**: An inline atom node gives clean semantics: the badge is a single unit for cursor navigation, selection, and deletion. React NodeView integrates naturally with the existing component patterns. The autocomplete plugin can't fire inside a node.

**Node spec:**
```
name: 'wikilink'
group: 'inline'
inline: true
atom: true
attrs:
  target: { default: '' }  // e.g. "Architecture" or "Infra/Architecture" or "Page#Heading"
  alias: { default: null }  // e.g. "display text" from [[Page|display text]]
```

### D2: Markdown serialization via tiptap-markdown extension hooks

**Decision**: Register custom `parse` and `serialize` rules on the tiptap-markdown extension config to handle `[[...]]` ↔ wikilink node conversion.

**Approach:**
- **Parse (markdown → ProseMirror)**: Pre-process the HTML from tiptap-markdown's parser. Since tiptap-markdown parses markdown to HTML first, and `[[...]]` is not valid markdown syntax, it passes through as literal text. Use a `transformPastedHTML` or a post-parse step to find `[[...]]` patterns in text nodes and replace them with `<wikilink target="..." alias="...">` elements that the node spec's `parseDOM` rule picks up.
- **Serialize (ProseMirror → markdown)**: Add a `renderText` or serializer entry for the wikilink node type that outputs `[[target]]` or `[[target|alias]]`.

**Alternatives considered:**
- *Custom markdown-it plugin*: More principled but heavier — requires writing a markdown-it tokenizer rule and integrating it with tiptap-markdown's pipeline. The pre/post-processing approach is simpler and sufficient for a well-defined pattern like `[[...]]`.

### D3: Validity resolution from in-memory file tree

**Decision**: The NodeView component resolves link validity at render time by looking up the `target` attribute against the file tree already in React state (used by autocomplete).

**Implementation:**
- The file tree (`FileEntry[]`) is passed to the editor via context or props
- NodeView receives it and calls a `resolveWikilink(target, currentFile, fileTree)` function
- Returns one of: `{ status: 'valid', resolvedPath }` | `{ status: 'broken' }` | `{ status: 'ambiguous', candidates[] }`
- The same `resolveWikilink` logic from the backend's `link-parser.ts` is ported to a shared module or duplicated on the frontend (it's ~40 lines of pure logic)
- When the file tree changes (file created/deleted/renamed), React re-renders and badges re-evaluate

### D4: Edit popover reuses autocomplete UI

**Decision**: Double-clicking a wikilink badge opens a floating popover containing the same autocomplete input/suggestion UI already used during wikilink creation.

**Flow:**
1. Double-click badge → popover appears anchored to the badge, pre-filled with current target
2. User edits the text → suggestions filter in real-time (same `filterNotes` / `filterHeadings` logic)
3. User selects a suggestion or presses Enter → badge's `target` attribute updates via ProseMirror transaction
4. Escape or click-outside → popover closes, no change

**Popover component**: A new `WikilinkEditPopover` React component. It renders outside the editor DOM (portal) to avoid ProseMirror DOM ownership issues. The existing `WikilinkAutocomplete` suggestion list component is reused inside it.

### D5: Click-to-navigate via NodeView event handler

**Decision**: The NodeView React component handles `onClick` directly for navigation, replacing the current `LinkClickExtension` for wikilinks.

**Implementation:**
- `onClick` (single click, no modifier needed): call `onNavigate(noteName, headingSlug)` — same callback used by the existing `LinkClickExtension`
- The `LinkClickExtension` plugin is kept for standard markdown links and anchor links, but its `[[...]]` detection code is removed since wikilinks are no longer text
- NodeView sets `contentEditable={false}` and `draggable={false}` to prevent cursor placement inside the badge

### D6: Disambiguation via path prefix in target attribute

**Decision**: When the autocomplete selection is ambiguous (multiple files share a basename), the target stores the relative path prefix needed to disambiguate (e.g., `Infra/Architecture` instead of just `Architecture`).

**Implementation:**
- `filterNotes()` already returns `dir` (directory hint) for each suggestion
- When multiple suggestions share the same `label` (basename), the insertion uses `dir/label` as the target
- The NodeView displays only the basename by default, with a subtle folder hint when disambiguated
- Existing bare ambiguous links (e.g., `[[Architecture]]` matching 2+ files) show a warning indicator on the badge, and double-click-to-edit lets the user pick the right one

### D7: Rename sync for open editors via OT

**Decision**: Extend the existing backend rename-rewrite flow to emit OT operations for files currently open in editor sessions.

**Current flow** (already implemented per link-index spec):
1. File renamed → backend finds all files with `[[old name]]` via `note_link` table
2. For each file: read markdown → regex replace → write to disk
3. File watcher picks up changes → re-indexes

**Extended flow:**
1. Same as above for files not open in an editor
2. For files with an active OT session: instead of writing to disk directly, emit an OT operation that replaces the old wikilink text with the new one
3. The OT server applies the operation → clients receive update → ProseMirror re-parses → badge updates

The OT operation is a text-level replacement (`[[old name]]` → `[[new name]]`), not a node-level operation, because OT operates on the serialized markdown. When the client receives the updated markdown, the parse step converts it back to the correct wikilink node.

## Risks / Trade-offs

**[Risk] tiptap-markdown parse timing**: The `[[...]]` pattern needs to be converted to nodes during markdown→ProseMirror parsing. If the conversion runs at the wrong stage (e.g., before tiptap-markdown processes the HTML), nodes may not be created correctly.
→ *Mitigation*: Prototype the parse hook first. If the standard tiptap-markdown hooks don't work cleanly, fall back to a post-parse ProseMirror step that walks text nodes and replaces `[[...]]` matches with wikilink nodes via transaction.

**[Risk] Cursor behavior around atomic nodes**: ProseMirror's cursor behavior around inline atoms can feel unnatural (e.g., two arrow presses to move past a node — once to select, once to move past).
→ *Mitigation*: This is standard ProseMirror atom behavior. Test and tune with `gapcursor` extension if needed.

**[Risk] OT rename operations on open documents**: Emitting OT operations from the backend during rename could conflict with concurrent user edits.
→ *Mitigation*: OT is designed for concurrent edits — treat the rename as a "server edit" applied through the normal OT transform pipeline. The existing OT infrastructure handles conflicts.

**[Risk] Performance with many badges**: Documents with 50+ wikilinks create 50+ React NodeView components.
→ *Mitigation*: NodeView components are lightweight (a single `<span>` with a click handler and a file-tree lookup). Profile if this becomes an issue, but unlikely to be a problem at typical document sizes.

**[Trade-off] Atomic node vs. live preview**: Users can't partially edit a wikilink by clicking into it — they must use the edit popover. This is less fluid than Obsidian's live preview but eliminates the entire class of cursor-position bugs and is consistent with how Notion handles page mentions.
