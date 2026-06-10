## ADDED Requirements

### Requirement: Wikilink inline node definition
The editor SHALL represent wikilinks as custom TipTap inline atom nodes with `target` and `alias` attributes, replacing plain-text `[[...]]` representation.

#### Scenario: Node attributes for simple wikilink
- **WHEN** the markdown contains `[[Architecture]]`
- **THEN** the editor creates a wikilink node with `target: "Architecture"` and `alias: null`

#### Scenario: Node attributes for wikilink with heading
- **WHEN** the markdown contains `[[Architecture#Overview]]`
- **THEN** the editor creates a wikilink node with `target: "Architecture#Overview"` and `alias: null`

#### Scenario: Node attributes for wikilink with alias
- **WHEN** the markdown contains `[[Architecture|see arch doc]]`
- **THEN** the editor creates a wikilink node with `target: "Architecture"` and `alias: "see arch doc"`

#### Scenario: Node attributes for disambiguated wikilink
- **WHEN** the markdown contains `[[Infra/Architecture]]`
- **THEN** the editor creates a wikilink node with `target: "Infra/Architecture"` and `alias: null`

#### Scenario: Node is atomic
- **WHEN** a wikilink node exists in the document
- **THEN** the cursor SHALL NOT be placeable inside the node; arrow keys skip over it as a single unit

### Requirement: Badge rendering
The wikilink node SHALL render as a styled pill/badge element via a React NodeView component.

#### Scenario: Default badge display
- **WHEN** a wikilink node has `target: "Architecture"` and no alias
- **THEN** the badge displays a document icon and the text "Architecture"

#### Scenario: Badge with alias
- **WHEN** a wikilink node has `target: "Architecture"` and `alias: "see arch doc"`
- **THEN** the badge displays a document icon and the alias text "see arch doc"

#### Scenario: Badge with path prefix
- **WHEN** a wikilink node has `target: "Infra/Architecture"`
- **THEN** the badge displays a document icon, the text "Architecture", and a subtle directory hint "Infra/"

#### Scenario: Badge with heading
- **WHEN** a wikilink node has `target: "Architecture#Overview"`
- **THEN** the badge displays a document icon and the text "Architecture > Overview" (or equivalent visual separator for the heading)

### Requirement: Visual states based on link validity
The badge SHALL visually indicate whether the wikilink target resolves to an existing file, using the in-memory file tree.

#### Scenario: Valid link styling
- **WHEN** the wikilink target resolves to exactly one existing file
- **THEN** the badge renders with a solid muted background pill style

#### Scenario: Broken link styling
- **WHEN** the wikilink target does not match any existing file
- **THEN** the badge renders with a dashed or dimmed pill style indicating the target does not exist

#### Scenario: Ambiguous link styling
- **WHEN** the wikilink target basename matches multiple files and no disambiguation path is provided
- **THEN** the badge renders with a warning indicator

#### Scenario: Hover state
- **WHEN** the user hovers over any wikilink badge
- **THEN** the badge background lightens and the cursor changes to pointer

#### Scenario: Hover tooltip
- **WHEN** the user hovers over a valid wikilink badge
- **THEN** a tooltip displays the full resolved file path

#### Scenario: Broken link tooltip
- **WHEN** the user hovers over a broken wikilink badge
- **THEN** a tooltip displays "Note does not exist"

#### Scenario: Reactive validity updates
- **WHEN** a file is created, deleted, or renamed and the file tree state updates
- **THEN** all wikilink badges re-evaluate their validity state without requiring a page reload

### Requirement: Click-to-navigate
The system SHALL navigate to the linked document when a wikilink badge is single-clicked.

#### Scenario: Navigate to note
- **WHEN** the user single-clicks a valid wikilink badge with target "Architecture"
- **THEN** the editor navigates to the "Architecture" note

#### Scenario: Navigate to note with heading
- **WHEN** the user single-clicks a valid wikilink badge with target "Architecture#Overview"
- **THEN** the editor navigates to the "Architecture" note and scrolls to the "Overview" heading

#### Scenario: Navigate to same-page heading
- **WHEN** the user single-clicks a wikilink badge with target "#Overview"
- **THEN** the editor scrolls to the "Overview" heading within the current document

#### Scenario: Click on broken link
- **WHEN** the user single-clicks a broken wikilink badge
- **THEN** nothing happens (no navigation, no note creation)

#### Scenario: Click on ambiguous link
- **WHEN** the user single-clicks an ambiguous wikilink badge
- **THEN** the edit popover opens to allow the user to disambiguate

### Requirement: Keyboard behavior
The wikilink badge SHALL support standard ProseMirror inline atom keyboard interactions.

#### Scenario: Arrow key navigation
- **WHEN** the cursor is adjacent to a wikilink badge and the user presses the arrow key toward it
- **THEN** the badge is selected as a whole (node selection), and the next arrow press moves past it

#### Scenario: Delete badge with backspace
- **WHEN** a wikilink badge is selected and the user presses Backspace or Delete
- **THEN** the badge is removed from the document

#### Scenario: Enter on selected badge opens edit popover
- **WHEN** a wikilink badge is selected and the user presses Enter
- **THEN** the edit popover opens for that badge

### Requirement: Markdown serialization
The system SHALL serialize wikilink nodes to `[[...]]` markdown syntax and parse `[[...]]` markdown back to wikilink nodes.

#### Scenario: Serialize simple wikilink
- **WHEN** a wikilink node has `target: "Architecture"` and no alias
- **THEN** it serializes to `[[Architecture]]` in markdown output

#### Scenario: Serialize wikilink with alias
- **WHEN** a wikilink node has `target: "Architecture"` and `alias: "see arch doc"`
- **THEN** it serializes to `[[Architecture|see arch doc]]` in markdown output

#### Scenario: Serialize wikilink with heading
- **WHEN** a wikilink node has `target: "Architecture#Overview"`
- **THEN** it serializes to `[[Architecture#Overview]]` in markdown output

#### Scenario: Parse wikilinks from markdown
- **WHEN** markdown content containing `[[Architecture]]` is loaded into the editor
- **THEN** the text is converted to a wikilink node with `target: "Architecture"`

#### Scenario: Parse wikilinks with alias from markdown
- **WHEN** markdown content containing `[[Architecture|see arch doc]]` is loaded into the editor
- **THEN** the text is converted to a wikilink node with `target: "Architecture"` and `alias: "see arch doc"`

#### Scenario: Preserve non-wikilink double brackets
- **WHEN** markdown content contains `[[` that is not a valid wikilink (e.g., inside a code block or incomplete)
- **THEN** the text is left as plain text, not converted to a node

### Requirement: Autocomplete creates wikilink nodes
The existing `[[` autocomplete SHALL insert wikilink nodes instead of plain text when a suggestion is selected.

#### Scenario: Autocomplete inserts node
- **WHEN** the user types `[[Arch` and selects "Architecture" from the autocomplete dropdown
- **THEN** the typed text `[[Arch` is replaced with a wikilink node with `target: "Architecture"`

#### Scenario: Autocomplete with heading inserts node
- **WHEN** the user types `[[Architecture#Over` and selects "Overview" from the heading dropdown
- **THEN** the typed text is replaced with a wikilink node with `target: "Architecture#Overview"`

#### Scenario: Autocomplete disambiguates with path
- **WHEN** the user types `[[Architecture` and multiple files named "Architecture.md" exist, and the user selects the one in "Infra/"
- **THEN** a wikilink node is created with `target: "Infra/Architecture"`

#### Scenario: Autocomplete does not fire inside existing node
- **WHEN** the user clicks inside or adjacent to an existing wikilink badge
- **THEN** the autocomplete dropdown does NOT appear
