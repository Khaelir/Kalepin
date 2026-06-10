## MODIFIED Requirements

### Requirement: Backlinks panel layout
The system SHALL display the backlinks panel as a tab within the right rail, with sections for backlinks, outgoing links, and unlinked mentions.

#### Scenario: Panel opens with backlinks section
- **WHEN** the user clicks the "Backlinks" tab in the right rail
- **THEN** the rail displays the "Backlinks" tab content with all sections (backlinks, outgoing links, unlinked mentions)

#### Scenario: Backlink entry display
- **WHEN** backlinks are displayed
- **THEN** each entry shows the source note's title (derived from filename), the context line containing the link, and the link is clickable to navigate to the source note

#### Scenario: Outgoing links section
- **WHEN** the Backlinks tab is active
- **THEN** a collapsible "Outgoing Links" section shows all notes the current note links to, each clickable to navigate to that note

#### Scenario: Unlinked mentions section
- **WHEN** the Backlinks tab is active and unlinked mentions exist
- **THEN** a collapsible "Unlinked Mentions" section shows notes that mention the current note's title without a link, each with a "Link" button to convert the mention to a wikilink

#### Scenario: Empty states
- **WHEN** a section has no entries
- **THEN** the section displays a brief message (e.g., "No backlinks found")

#### Scenario: Tab coexists with other right-rail tabs
- **WHEN** another right-rail tab (Comments, Activity, Outline) is active and the user clicks Backlinks
- **THEN** the rail switches to the Backlinks tab content — tabs are the unit of switching; one tab is active at a time, but all tab panels exist in the same rail component

### Requirement: Backlinks toolbar button
The top bar SHALL include a button (or the right-rail tab strip) that activates the Backlinks tab for the currently open note, with a badge showing the backlink count.

#### Scenario: Button visible when a note is open
- **WHEN** a user has a note open in the editor
- **THEN** the Backlinks tab is enabled in the right rail tab strip; if a dedicated top-bar button exists, it also is visible

#### Scenario: Tab/button shows backlink count
- **WHEN** the current note has backlinks
- **THEN** the tab label (or top-bar button) displays a badge with the number of incoming links

#### Scenario: Disabled when no note is open
- **WHEN** no note is open in the editor
- **THEN** the Backlinks tab is disabled or hidden
