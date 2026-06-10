## Context

Kalepin stores notes as plain markdown files on disk and uses `[[wikilink]]` syntax for inter-note links, consistent with Obsidian. The link parser (`link-parser.ts`) extracts wikilinks and resolves them to file paths using shortest-unique-path matching. However:

1. There is **no editor autocomplete** when typing `[[` -- users must type note names from memory.
2. The parser treats `[[Page#Heading]]` as a literal target `Page#Heading`, failing to resolve it. Obsidian and most wiki-link tools treat `#` as a heading anchor separator.

The editor already has two relevant autocomplete patterns: slash commands (`/` trigger, ProseMirror plugin) and mention autocomplete (`@` trigger, React component in FloatingInput). The heading infrastructure is also in place: headings get `id` attributes via `slugify()`, and `LinkClickExtension` already navigates to `#hash` fragments.

## Goals / Non-Goals

**Goals:**
- Obsidian-compatible `[[Page#Heading]]` syntax: parse, resolve, navigate
- Inline autocomplete for note names triggered by `[[`
- Heading sub-suggestions after `#` within a wikilink
- Same-page heading links via `[[#Heading]]`
- Keep files portable -- no custom syntax beyond the widely-used wikilink convention

**Non-Goals:**
- Block references (`[[Page#^block-id]]`)
- Heading rename propagation (updating `#heading` in linking notes when a heading changes)
- Transclusion / note embedding (`![[embed]]`)
- Storing heading fragments in the `note_links` DB table

## Decisions

### D1: Autocomplete as a ProseMirror plugin (like slash commands)

**Choice:** Implement wikilink autocomplete as a ProseMirror plugin with a React dropdown, following the same pattern as `createSlashMenuPlugin`.

**Rationale:** The slash command plugin is already proven in the codebase. It handles trigger detection, keyboard navigation, positioning, and read-only mode gating. The wikilink plugin uses the same architecture:
- Plugin detects `[[` followed by query text via regex on text before cursor
- Plugin state tracks active/query/position/selected index
- React component renders the dropdown using plugin state
- Keyboard events (arrows, Enter, Escape) are intercepted by the plugin

**Alternatives considered:**
- TipTap `@tiptap/suggestion` extension: Adds a dependency and its API is designed for mention-style nodes, not plain text insertion. Wikilinks in this codebase are plain markdown text, not custom ProseMirror nodes.
- Separate React-only approach (like MentionAutocomplete): MentionAutocomplete works in a simple textarea, not in the ProseMirror editor. ProseMirror needs plugin-level keyboard interception to prevent default editor behavior during autocomplete.

### D2: Two-phase autocomplete (notes then headings)

**Choice:** The autocomplete operates in two phases within a single dropdown:
1. **Note phase**: Triggered by `[[`, shows note names filtered by typed query
2. **Heading phase**: When the query contains `#`, everything before `#` is the note name, everything after is the heading filter. The dropdown switches to show headings of the resolved note.

Special case: `[[#` (nothing before `#`) enters heading phase for the current document.

**Rationale:** This matches Obsidian's UX exactly. Users who type `[[Page#` expect heading suggestions for `Page`, not notes with `#` in the name.

**State machine:**
```
         type [[
Inactive ──────────► Note Phase
                        │
              type # or select+#
                        │
                        ▼
                   Heading Phase
                        │
              Enter / click / ]]
                        │
                        ▼
                    Inactive
                   (text inserted)
```

### D3: Note suggestions from file tree (no new API)

**Choice:** Use the already-loaded file tree data (`fetchFileTree()`) for note suggestions, filtering client-side.

**Rationale:** The file tree is already fetched on app load and kept in React state. For a vault of a few thousand notes, client-side filtering of basenames is instant. No new backend endpoint needed for note suggestions.

If the file tree is very large and client-side filtering becomes slow, a dedicated search endpoint could be added later -- but this is unlikely given the target vault sizes (under 5000 notes, per existing performance assumptions in the link-index spec).

**Alternatives considered:**
- Using `GET /api/files/search`: This endpoint does FTS5 full-text search on note content, not filename matching. Overkill and wrong semantics for autocomplete.
- New dedicated endpoint: Unnecessary complexity when the data is already on the client.

### D4: New backend endpoint for note headings

**Choice:** Add `GET /api/files/headings?path=<note-path>` that reads a note's markdown, extracts headings via regex (`/^(#{1,6})\s+(.+)$/`), and returns `{ level: number, text: string }[]`.

**Rationale:** The frontend doesn't have the raw markdown of other notes readily available (only the currently open document). The backend needs to read the file and extract headings. The same heading extraction regex is already used in `chunk-markdown.ts`'s `splitByHeadings`.

For the current document (same-page `[[#Heading]]`), the frontend can extract headings directly from the ProseMirror document state (iterate `doc.descendants` for heading nodes), avoiding an API call entirely.

### D5: Heading fragment is a navigation hint, not indexed

**Choice:** The `#heading` portion of `[[Page#Heading]]` is stripped before link indexing. The `rawTarget` stored in `note_links` is `Page`, not `Page#Heading`. Navigation to the heading happens at click time only.

**Rationale:**
- A backlink to `Page#Section` is semantically a backlink to `Page`
- Heading text changes frequently; indexing it would require reindexing all linking notes when a heading is renamed
- The fragment is preserved in the raw markdown on disk -- it just doesn't enter the DB
- This matches how HTML fragment identifiers work (the `#` part is client-side only)

### D6: Slugification alignment with Obsidian

**Choice:** Use the existing `slugify()` function for heading IDs in the editor. Accept that Obsidian's heading matching is case-insensitive on the raw text, while Kalepin's scroll-to-heading uses slugified IDs. The practical difference is negligible for Latin scripts.

**Rationale:** Obsidian resolves `[[Page#Some Heading]]` by matching `Some Heading` case-insensitively against heading text, then generating its own anchor. Kalepin's approach is: slugify the heading text to create an element ID, then scroll to that element. Both produce the same navigation result for the vast majority of headings. Exotic edge cases (headings with emoji, CJK characters) may differ, but this is acceptable for v1.

### D7: Insertion behavior

**Choice:** When a user selects a suggestion:
- The typed `[[query` text (including the `[[` trigger) is replaced with the completed wikilink `[[Note Title]]` or `[[Note Title#Heading]]`
- The closing `]]` is inserted automatically
- Cursor is placed after `]]`

If the user types `]]` manually (without selecting from dropdown), the autocomplete dismisses and the raw text is kept as-is -- the parser handles it on save.

## Risks / Trade-offs

**[Large file trees may slow client-side filtering]** For vaults with 10,000+ notes, filtering the full file list on every keystroke could cause jank. **Mitigation:** Debounce filtering (50ms) and limit displayed results to ~20 items. If needed later, switch to a backend search endpoint.

**[Heading endpoint reads files on every request]** Each `#` keystroke that changes the resolved note triggers a backend read. **Mitigation:** The frontend should cache headings per note path for the duration of the autocomplete session (cleared when `[[` is dismissed). Also debounce the API call (100ms).

**[Slugify mismatch with Obsidian for edge cases]** Headings with special characters may produce different anchors than Obsidian. **Mitigation:** Acceptable for v1. Document the slugify rules. Can be refined later if users report issues.

**[No heading rename propagation]** If a heading is renamed, existing `[[Page#OldHeading]]` links won't update and will fail to scroll. **Mitigation:** The link still navigates to the correct page -- only the scroll-to-heading fails. This is consistent with Obsidian's behavior (Obsidian also doesn't auto-update heading refs on rename).
