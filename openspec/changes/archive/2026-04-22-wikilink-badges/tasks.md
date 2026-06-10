## 1. Wikilink Node Definition & Markdown Serialization

- [x] 1.1 Create TipTap `wikilink` inline node extension (`Node.create()`) with `atom: true`, `inline: true`, `group: 'inline'`, and attributes `target` (string) and `alias` (string | null)
- [x] 1.2 Implement markdown parse rule: detect `[[...]]` patterns in text and convert to wikilink nodes during markdown→ProseMirror loading (handle `[[target]]`, `[[target|alias]]`, `[[target#heading]]` variants; skip code blocks and incomplete brackets)
- [x] 1.3 Implement markdown serialize rule: wikilink node → `[[target]]` or `[[target|alias]]` text output
- [x] 1.4 Register the wikilink extension in the editor's TipTap extensions array and verify round-trip: load markdown with `[[...]]` → nodes created → serialize back → identical markdown

## 2. Badge NodeView Rendering

- [x] 2.1 Create `WikilinkNodeView` React component rendering a pill/badge with document icon, target text display (basename, folder hint for disambiguated paths, heading separator)
- [x] 2.2 Implement link validity resolution: port `resolveWikilink` logic to frontend, look up target against in-memory file tree, return valid/broken/ambiguous status
- [x] 2.3 Add CSS for badge visual states: valid (solid muted pill), broken (dashed/dimmed pill), ambiguous (warning indicator), hover (lighter background, pointer cursor), keyboard-selected (accent highlight)
- [x] 2.4 Add hover tooltip: full resolved path for valid links, "Note does not exist" for broken links
- [x] 2.5 Wire up reactive validity updates: when file tree state changes, badges re-evaluate their validity

## 3. Click-to-Navigate

- [x] 3.1 Implement `onClick` handler in NodeView: single click calls `onNavigate(noteName, headingSlug)` for valid links, opens edit popover for ambiguous links, no-op for broken links
- [x] 3.2 Implement same-page heading navigation: target starting with `#` scrolls to heading within current document
- [x] 3.3 Remove the `[[...]]` wikilink detection code from `LinkClickExtension` (keep markdown link and anchor link handling)

## 4. Edit Popover

- [x] 4.1 Create `WikilinkEditPopover` React component: floating portal anchored to badge, text input pre-filled with current target, suggestion list reusing `WikilinkAutocomplete` UI
- [x] 4.2 Wire trigger: double-click on badge or Enter on selected badge opens the popover
- [x] 4.3 Implement autocomplete inside popover: reuse `filterNotes` and `filterHeadings` logic, support note phase and heading phase (triggered by `#`)
- [x] 4.4 Implement confirmation: selecting a suggestion or pressing Enter updates the wikilink node's `target` attribute via ProseMirror transaction, closes popover
- [x] 4.5 Implement dismissal: Escape or click-outside closes popover without changes, returns focus to editor

## 5. Autocomplete Node Insertion

- [x] 5.1 Modify `wikilink-autocomplete.ts` insertion logic: on selection, replace typed `[[query` text with a wikilink node (instead of plain text `[[target]]`)
- [x] 5.2 Handle disambiguation on insert: when multiple files share a basename, use the `dir/label` path as the node's target attribute
- [x] 5.3 Verify autocomplete does not fire when cursor is adjacent to or inside an existing wikilink node (node boundary prevents regex match)

## 6. Rename Sync for Open Editors

- [x] 6.1 Extend backend rename handler: when rewriting wikilinks on file rename, check if the source file has an active OT session
- [x] 6.2 For files with active OT sessions, emit an OT text-replacement operation (`[[old name]]` → `[[new name]]`) through the OT pipeline instead of writing to disk
- [x] 6.3 For files without active OT sessions, keep existing read-replace-write-to-disk behavior
- [x] 6.4 Verify that client receives OT update, re-parses markdown, and badge updates with new target and re-evaluated validity

## 7. Integration & Cleanup

- [x] 7.1 End-to-end test: create note with wikilinks, verify badges render, click navigates, double-click edits, rename updates badges
- [x] 7.2 Verify BacklinksPanel still works correctly (it queries backend index, should be unaffected)
- [x] 7.3 Verify OT collaboration: two clients viewing same document both see badge updates when file tree changes or renames occur
