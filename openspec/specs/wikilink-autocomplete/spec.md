## Purpose

Provides inline autocomplete for wikilinks in the editor — note-name suggestions after `[[`, heading suggestions after `#`, and heading navigation on click — including a backend endpoint to fetch a note's headings.

## Requirements

### Requirement: Wikilink note autocomplete
The system SHALL display an inline autocomplete dropdown when the user types `[[` in the editor, suggesting note names from the vault.

#### Scenario: Trigger autocomplete
- **WHEN** the user types `[[` in the editor (not inside a code block)
- **THEN** a dropdown appears near the cursor showing note names from the vault, sorted by relevance (basename match)

#### Scenario: Filter suggestions by query
- **WHEN** the user types `[[princ`
- **THEN** the dropdown filters to show only notes whose basename contains "princ" (case-insensitive)

#### Scenario: Select a note with Enter
- **WHEN** the dropdown is open and the user presses Enter on a highlighted note "Principe generique"
- **THEN** the typed text `[[princ` is replaced with `[[Principe generique]]` and the cursor is placed after `]]`

#### Scenario: Select a note with click
- **WHEN** the dropdown is open and the user clicks on "Principe generique"
- **THEN** the typed text is replaced with `[[Principe generique]]` and the cursor is placed after `]]`

#### Scenario: Keyboard navigation
- **WHEN** the dropdown is open
- **THEN** Arrow Up/Down navigates the highlighted item, Enter selects, Escape dismisses the dropdown

#### Scenario: Dismiss on Escape
- **WHEN** the dropdown is open and the user presses Escape
- **THEN** the dropdown closes and the typed text `[[query` is left as-is

#### Scenario: Dismiss on cursor move away
- **WHEN** the dropdown is open and the user moves the cursor outside the `[[...` text (e.g., clicks elsewhere)
- **THEN** the dropdown closes

#### Scenario: No match
- **WHEN** the user types `[[xyznonexistent` and no notes match
- **THEN** the dropdown shows an empty state or dismisses

#### Scenario: Do not trigger in code blocks
- **WHEN** the user types `[[` inside a code block or inline code
- **THEN** no autocomplete dropdown appears

### Requirement: Heading autocomplete after `#`
The system SHALL switch the autocomplete dropdown to show headings of a specific note when the user types `#` after a note name inside `[[`.

#### Scenario: Type `#` after note name
- **WHEN** the user types `[[Principe generique#` (the note resolves to a valid file)
- **THEN** the dropdown switches to show all headings from "Principe generique", with their level indicated (e.g., H1, H2, H3)

#### Scenario: Filter headings by query
- **WHEN** the user types `[[Principe generique#intro`
- **THEN** the dropdown filters to show only headings containing "intro" (case-insensitive)

#### Scenario: Select a heading
- **WHEN** the user selects "Introduction" from the heading dropdown
- **THEN** the typed text is replaced with `[[Principe generique#Introduction]]` and the cursor is placed after `]]`

#### Scenario: Note not found for heading phase
- **WHEN** the user types `[[NonExistentNote#`
- **THEN** the dropdown shows an empty state (no headings to display)

#### Scenario: Note has no headings
- **WHEN** the user types `[[SomeNote#` and the note contains no headings
- **THEN** the dropdown shows an empty state

### Requirement: Same-page heading autocomplete
The system SHALL show headings from the current document when the user types `[[#` (no note name before the `#`).

#### Scenario: Same-page heading trigger
- **WHEN** the user types `[[#` while editing "MyNote.md"
- **THEN** the dropdown shows all headings from the current document

#### Scenario: Select same-page heading
- **WHEN** the user selects "Architecture" from the dropdown after typing `[[#`
- **THEN** the typed text is replaced with `[[#Architecture]]` and the cursor is placed after `]]`

#### Scenario: Same-page headings come from editor state
- **WHEN** the user types `[[#` after having just added a new heading "New Section" in the current document (not yet saved)
- **THEN** "New Section" appears in the heading suggestions (extracted from ProseMirror document state, not from disk)

### Requirement: Alias support with heading fragments
The system SHALL allow aliases in combination with heading fragments: `[[Page#Heading|display text]]`.

#### Scenario: Autocomplete does not interfere with alias pipe
- **WHEN** the user selects a heading and the wikilink becomes `[[Page#Heading]]`, then the user manually edits it to `[[Page#Heading|see this]]`
- **THEN** the wikilink is valid and renders/navigates correctly

### Requirement: Backend heading extraction endpoint
The system SHALL provide an API endpoint to retrieve all headings from a given note.

#### Scenario: Fetch headings
- **WHEN** a client sends `GET /api/files/headings?path=notes/Architecture.md`
- **THEN** the system returns an array of `{ level: number, text: string }` for each heading in the note, in document order

#### Scenario: File not found
- **WHEN** a client sends `GET /api/files/headings?path=nonexistent.md`
- **THEN** the system returns a 404 status

#### Scenario: File with no headings
- **WHEN** a client sends `GET /api/files/headings?path=plain-text.md` and the file has no markdown headings
- **THEN** the system returns an empty array

### Requirement: Wikilink click navigates to heading
The system SHALL navigate to the referenced heading when a user clicks a wikilink that contains a `#heading` fragment.

#### Scenario: Click wikilink with heading
- **WHEN** a user clicks on a rendered `[[Architecture#API Design]]` link
- **THEN** the system navigates to the "Architecture" note and scrolls to the heading with id matching `slugify("API Design")`

#### Scenario: Click same-page heading link
- **WHEN** a user clicks on a rendered `[[#API Design]]` link within the same document
- **THEN** the editor scrolls to the heading with id matching `slugify("API Design")` without reloading the document

#### Scenario: Heading not found in target note
- **WHEN** a user clicks `[[Page#NonExistentHeading]]` and the heading does not exist in Page
- **THEN** the system navigates to Page but does not scroll (the note opens at the top)
