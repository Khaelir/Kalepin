## Why

Wikilinks (`[[...]]`) are currently raw text in the editor. This causes a UX bug where clicking inside an existing wikilink triggers autocomplete — selecting a suggestion corrupts the link by appending text. Navigation requires the non-discoverable Cmd+Click shortcut. Users expect wikilinks to behave like interactive elements: click to navigate, visually distinct from surrounding text, and resilient to file renames.

## What Changes

- **Wikilink inline node**: Replace plain-text `[[...]]` with a custom TipTap inline node that renders as a styled pill/badge with a document icon
- **Click-to-navigate**: Single click on a badge navigates to the linked document (or scrolls to heading). No modifier key needed
- **Double-click-to-edit**: Opens a popover with autocomplete to change the link target, reusing the existing autocomplete UI
- **Visual states**: Valid links show a solid pill; broken links (target doesn't exist) show a dashed/dimmed pill; ambiguous links (multiple basename matches) show a warning state
- **Validity resolution**: Badge checks the in-memory file tree at render time to determine valid/broken/ambiguous state; reactively updates when the file tree changes
- **Disambiguation**: When autocomplete matches multiple files with the same basename, the relative path is inserted (e.g., `[[Infra/Architecture]]`), matching Obsidian behavior
- **Rename sync for open editors**: Extend existing rename-rewrite logic to push wikilink updates through OT for files open in editor sessions (on-disk rewriting already spec'd in link-index)
- **Markdown serialization**: Custom tiptap-markdown parser/serializer to round-trip `[[...]]` ↔ wikilink nodes
- **Autocomplete inserts node**: The `[[` autocomplete now inserts a wikilink node instead of raw text, eliminating the corruption bug by design

## Capabilities

### New Capabilities
- `wikilink-node`: TipTap inline node definition, NodeView rendering (badge/pill), visual states (valid/broken/ambiguous), click-to-navigate, keyboard behavior (arrow skip, backspace delete), hover tooltip, and markdown serialization
- `wikilink-edit-popover`: Double-click edit interaction — popover with autocomplete input for changing or disambiguating a wikilink target

### Modified Capabilities
- `link-index`: Add requirement for pushing wikilink rename updates through OT to open editor sessions (on-disk rewriting is already spec'd)

## Impact

- **Frontend editor**: New TipTap extension (`wikilink` node), updated `wikilink-autocomplete.ts` (insert node instead of text), new `WikilinkNodeView` React component, new `WikilinkEditPopover` component
- **Frontend styles**: New CSS for badge pill states (valid, broken, ambiguous, hover, selected)
- **tiptap-markdown integration**: Custom parse/serialize rules for `[[...]]` ↔ node conversion
- **Backend OT**: Rename handler needs to emit OT operations for open sessions when rewriting wikilinks
- **Existing `LinkClickExtension`**: Replaced by node-level click handling (Cmd+Click on plain text no longer needed)
- **Existing `WikilinkAutocomplete`**: Selection now creates a node instead of inserting text; UI component stays the same
