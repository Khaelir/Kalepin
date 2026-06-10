## 1. Link parser: heading fragment support

- [x] 1.1 Update `parseLinksFromMarkdown` in `link-parser.ts` to strip `#heading` from wikilink raw targets before indexing (split on first `#`, store only the note part as `rawTarget`)
- [x] 1.2 Handle same-page links (`[[#Heading]]`): extract as a wikilink with empty note target that resolves to the source file
- [x] 1.3 Ensure `[[Page#Heading|alias]]` is parsed correctly: strip `#heading` after splitting alias on `|`
- [x] 1.4 Update `resolveWikilink` to strip any `#fragment` from the target before resolution
- [x] 1.5 Add/update tests in `link-parser.test.ts` covering: `[[Page#Heading]]`, `[[Page#Heading|alias]]`, `[[#Heading]]`, and edge cases (no heading, empty heading `[[Page#]]`)

## 2. Backend: headings endpoint

- [x] 2.1 Add `GET /api/files/headings?path=<note-path>` endpoint in the files controller that reads a note and returns `{ level: number, text: string }[]` for each markdown heading
- [x] 2.2 Extract headings using the same regex as `chunk-markdown.ts` (`/^(#{1,6})\s+(.+)$/`)
- [x] 2.3 Return 404 if the file does not exist, empty array if no headings found
- [x] 2.4 Add the `fetchHeadings(path)` function to the frontend `api.ts`

## 3. Frontend: wikilink autocomplete plugin

- [x] 3.1 Create `wikilink-autocomplete.ts` with a ProseMirror plugin following the `createSlashMenuPlugin` pattern: detect `[[` trigger, track query text, manage plugin state (active, query, position, selectedIndex, phase: 'note' | 'heading')
- [x] 3.2 Implement note phase: regex `\[\[([^\]#|]*)$` to extract query after `[[`, filter file tree basenames client-side (case-insensitive substring match), limit to ~20 results
- [x] 3.3 Implement heading phase: detect `#` in query, split into note name + heading filter, switch dropdown to show headings from the resolved note (via headings endpoint)
- [x] 3.4 Implement same-page heading phase: when query starts with `#` (i.e., `[[#`), extract headings from ProseMirror document state (`doc.descendants` for heading nodes) instead of calling the API
- [x] 3.5 Handle keyboard events: ArrowUp/Down for navigation, Enter/Tab to select, Escape to dismiss. Prevent default editor behavior during autocomplete.
- [x] 3.6 Handle insertion: on selection, replace the `[[query` text with `[[Selected Note]]` or `[[Note#Heading]]`, place cursor after `]]`
- [x] 3.7 Skip activation inside code blocks and inline code (check `$from.parent.type.spec.code`)

## 4. Frontend: autocomplete dropdown component

- [x] 4.1 Create `WikilinkAutocomplete.tsx` React component that renders the suggestion dropdown, positioned using coordinates from the plugin state
- [x] 4.2 Note phase UI: show note basenames (with directory path hint for disambiguation), highlight matching query substring
- [x] 4.3 Heading phase UI: show heading text with level indicator (H1/H2/H3...), highlight matching query substring
- [x] 4.4 Empty state: show "No matches" when filter produces zero results
- [x] 4.5 Style the dropdown consistent with the existing slash command menu

## 5. Frontend: wikilink click navigation with heading

- [x] 5.1 Update `LinkClickExtension` in `Editor.tsx` to detect wikilinks containing `#heading` and pass the heading slug to `onNavigate(path, heading)`
- [x] 5.2 Handle same-page heading clicks (`[[#Heading]]`): scroll to heading within current document without navigation
- [x] 5.3 Verify existing `pendingHeadingRef` scroll-to-heading logic works end-to-end with wikilink clicks

## 6. Integration and wiring

- [x] 6.1 Register the wikilink autocomplete plugin as a TipTap extension in `Editor.tsx` (same pattern as `SlashMenuExtension`)
- [x] 6.2 Wire the plugin state to the `WikilinkAutocomplete` React component, passing file tree data and active file path
- [x] 6.3 Debounce heading API calls (100ms) and cache headings per note path during an autocomplete session
- [x] 6.4 End-to-end manual test: type `[[`, select note, type `#`, select heading, verify inserted text and click navigation
