## ADDED Requirements

### Requirement: Related notes section in the Backlinks panel
The Backlinks panel's list view SHALL include a collapsible "Related" section below Backlinks, Outgoing Links and Unlinked Mentions, listing the notes most semantically similar to the open note. Each entry SHALL show the note's title and folder, a "why" line naming the best-matching section with a short excerpt, and a subtle "not linked" chip when neither note links to the other. Clicking an entry SHALL open that note. The section SHALL be open by default and SHALL remember whether the viewer collapsed it.

#### Scenario: Related entries render
- **WHEN** the user opens the Backlinks tab on a note that has semantically similar notes
- **THEN** the "Related" section lists them with title, folder and a line such as "§ Deployment — Build the Docker image…"

#### Scenario: Unlinked related note is flagged
- **WHEN** a related note is not linked to or from the open note
- **THEN** its entry shows a "not linked" chip

#### Scenario: Navigate to a related note
- **WHEN** the user clicks a related entry
- **THEN** the editor opens that note

#### Scenario: Insert a link
- **WHEN** the open note is editable and the user clicks "Link" on an unlinked related entry
- **THEN** a paragraph containing `[[<note name>]]` is appended to the open note through the editor
- **AND** the entry no longer shows the "not linked" chip

#### Scenario: Empty state
- **WHEN** no note scores above the related-notes floor
- **THEN** the section shows "No related notes found"

#### Scenario: Unavailable state
- **WHEN** the server reports related notes as unavailable (semantic model not loaded)
- **THEN** the section shows a message that related notes need the semantic index, instead of an empty list

#### Scenario: Encrypted note
- **WHEN** the open note is under the user's `_secure/` folder
- **THEN** the section does not query the server and shows that related notes are not available for encrypted notes

#### Scenario: Refresh on navigation and after edits
- **WHEN** the user switches to another note
- **THEN** the section refetches immediately for the new note
- **AND WHEN** the open note is edited
- **THEN** the section refetches once edits have been idle long enough for the note to be re-embedded (debounced, ~50 seconds after the last change)

#### Scenario: Collapse is remembered
- **WHEN** the user collapses the "Related" section and switches notes
- **THEN** the section stays collapsed
