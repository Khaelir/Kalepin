## ADDED Requirements

### Requirement: Floating toolbar on non-empty prose selection
The editor SHALL display a floating formatting toolbar when the user's selection is inside `.kp-prose`, is non-empty, and the selection's bounding width is greater than 2px. The bubble MUST be horizontally centered above the selection's bounding rectangle, 52px above its top.

#### Scenario: Selection triggers bubble
- **WHEN** the user selects a word or phrase in the prose
- **THEN** the toolbar appears centered above the selection

#### Scenario: Zero-width selection hides bubble
- **WHEN** the user collapses the selection (click without drag)
- **THEN** the toolbar is hidden

#### Scenario: Selection outside prose
- **WHEN** the user selects text in the sidebar file search or the right rail
- **THEN** the bubble does not appear

### Requirement: Toolbar contents
The toolbar SHALL be 36px tall with 8px radius, `--kalepin-bg-elevated` background, and `--kalepin-box-shadow-lg` shadow. Buttons in order: Bold, Italic, Strikethrough, Underline, Inline code, Wiki-link `[[`, External link, Quote, H2, H3, vertical divider, Comment (primary), Ask AI.

#### Scenario: Bold button toggles bold
- **WHEN** the user clicks the Bold button with a selection
- **THEN** the selection is wrapped in bold formatting

#### Scenario: Wiki-link button wraps selection
- **WHEN** the user clicks the `[[` button
- **THEN** the selection is wrapped in `[[...]]` wiki-link syntax and the wikilink autocomplete opens

#### Scenario: H2/H3 converts block
- **WHEN** the user clicks H2 with a paragraph selection
- **THEN** the block is converted to an H2 heading

### Requirement: Comment button creates new thread
Clicking the Comment button SHALL open the new-comment composer attached to the current selection range, using the existing `onAddComment` flow and anchoring the thread to the selection's quoted text and position hint.

#### Scenario: Create comment from bubble
- **WHEN** the user selects text and clicks Comment
- **THEN** the right rail switches to Comments tab, a new empty thread composer is shown with the selection's quoted text preview, and on submit the thread is persisted via `addComment`

### Requirement: Ask AI button emits intent
Clicking the Ask AI button SHALL emit an "ask-AI" intent with the selection's text. In the initial implementation this MAY open a no-op tooltip ("Ask AI coming soon"); the button contract is reserved for future wiring.

#### Scenario: Ask AI in v1
- **WHEN** the user clicks Ask AI
- **THEN** the system acknowledges the intent (e.g., tooltip "Ask AI coming soon") — no error is thrown

### Requirement: Click-outside and escape dismiss
Clicking anywhere outside the toolbar, collapsing the selection, or pressing Escape SHALL hide the toolbar.

#### Scenario: Click outside
- **WHEN** the user clicks outside the toolbar while a selection exists
- **THEN** the toolbar hides

#### Scenario: Escape
- **WHEN** the user presses Escape while the toolbar is visible
- **THEN** the toolbar hides and the selection remains
