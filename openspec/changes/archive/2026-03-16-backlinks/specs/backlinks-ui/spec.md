## ADDED Requirements

### Requirement: Backlinks toolbar button
The editor toolbar SHALL include a button to open the backlinks panel for the currently open note.

#### Scenario: Button visible when a note is open
- **WHEN** a user has a note open in the editor
- **THEN** a backlinks icon (link/chain icon) is visible in the toolbar

#### Scenario: Button shows backlink count
- **WHEN** the current note has backlinks
- **THEN** the toolbar button displays a badge with the number of incoming links

#### Scenario: Button disabled when no note is open
- **WHEN** no note is open in the editor
- **THEN** the backlinks button is disabled or hidden

### Requirement: Backlinks panel layout
The system SHALL display a sidebar panel with sections for backlinks, outgoing links, and unlinked mentions.

#### Scenario: Panel opens with backlinks section
- **WHEN** the user clicks the backlinks toolbar button
- **THEN** a right sidebar panel opens showing a "Backlinks" section listing all notes that link to the current note

#### Scenario: Backlink entry display
- **WHEN** backlinks are displayed
- **THEN** each entry shows the source note's title (derived from filename), the context line containing the link, and the link is clickable to navigate to the source note

#### Scenario: Outgoing links section
- **WHEN** the panel is open
- **THEN** a collapsible "Outgoing Links" section shows all notes the current note links to, each clickable to navigate to that note

#### Scenario: Unlinked mentions section
- **WHEN** the panel is open and unlinked mentions exist
- **THEN** a collapsible "Unlinked Mentions" section shows notes that mention the current note's title without a link, each with a "Link" button to convert the mention to a wikilink

#### Scenario: Empty states
- **WHEN** a section has no entries
- **THEN** the section displays a brief message (e.g., "No backlinks found")

#### Scenario: Panel replaces other sidebar panels
- **WHEN** another sidebar panel (comments, version history) is open and the user opens backlinks
- **THEN** the backlinks panel replaces the other panel (one panel at a time)

### Requirement: Navigate to linked note
The system SHALL allow users to navigate to a linked note by clicking on a backlink or outgoing link entry.

#### Scenario: Click backlink entry
- **WHEN** the user clicks on a backlink entry
- **THEN** the editor opens the source note that contains the link

#### Scenario: Click outgoing link entry
- **WHEN** the user clicks on an outgoing link entry
- **THEN** the editor opens the target note

### Requirement: Convert unlinked mention from panel
The system SHALL allow users to convert an unlinked mention to a wikilink directly from the backlinks panel.

#### Scenario: Click "Link" on unlinked mention
- **WHEN** the user clicks the "Link" button on an unlinked mention entry
- **THEN** the system converts the plain-text mention in the source file to a `[[wikilink]]`
- **AND** the entry moves from "Unlinked Mentions" to "Backlinks"

### Requirement: Panel updates on navigation
The system SHALL refresh the backlinks panel content when the user switches to a different note.

#### Scenario: Switch notes with panel open
- **WHEN** the backlinks panel is open and the user opens a different note
- **THEN** the panel refreshes to show backlinks, outgoing links, and unlinked mentions for the newly opened note
