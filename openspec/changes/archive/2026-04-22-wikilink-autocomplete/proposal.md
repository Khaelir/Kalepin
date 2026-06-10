## Why

Wikilinks (`[[Page]]`) have no autocomplete in the editor -- users type note names from memory and hope they match. Additionally, the `[[Page#Heading]]` syntax used by Obsidian and other wiki-link tools is not parsed, so heading anchors written in Obsidian break when opened in Kalepin. Both gaps hurt the editing experience and reduce Obsidian compatibility.

## What Changes

- **Wikilink autocomplete**: Typing `[[` in the editor triggers a dropdown suggesting note names from the vault. The list filters as the user types. Selecting a note inserts a properly formatted wikilink.
- **Heading anchor autocomplete**: After a note name, typing `#` switches the dropdown to show that note's headings. For same-page links (`[[#`), headings from the current document are shown.
- **Heading fragment parsing**: The link parser splits `#heading` from the raw target so `[[Page#Section]]` resolves to `Page` (not a literal file named `Page#Section`). The heading fragment is a navigation hint only -- not stored in the link index.
- **Heading navigation on click**: Clicking a wikilink containing `#heading` navigates to the note and scrolls to the matching heading. This leverages existing heading ID and scroll-to-heading infrastructure.
- **Alias support preserved**: `[[Page#Heading|display text]]` works -- the alias pipe is handled after the heading fragment is split.

## Capabilities

### New Capabilities
- `wikilink-autocomplete`: Inline autocomplete triggered by `[[` in the editor, supporting note name suggestions and heading suggestions after `#`. Includes the backend endpoint to list headings for a given note.

### Modified Capabilities
- `link-index`: Parser must strip `#heading` fragments from wikilink targets before resolution. `[[Page#Intro]]` resolves the same as `[[Page]]` -- the fragment is not stored in the DB. Same-page links (`[[#Heading]]`) resolve to the current file.

## Impact

- **Frontend**: New ProseMirror plugin for `[[` autocomplete (similar pattern to existing slash commands). New React dropdown component for note/heading suggestions.
- **Backend**: New `GET /api/notes/:path/headings` endpoint (or similar) to extract headings from a note's markdown. Minor change to `link-parser.ts` to split `#` fragments.
- **No DB changes**: The `note_links` table schema is unchanged. Heading fragments are not persisted.
- **Obsidian compatibility**: Improves -- `[[Page#Heading]]` syntax is the same convention Obsidian uses. Files remain valid markdown readable in any editor.
