# Spec delta: tags-ui (ADDED)

## ADDED Requirements

### Requirement: Tags section in the sidebar

The sidebar SHALL show a collapsible "Tags" section (collapsed state persisted like the Starred and Recent sections) listing the tags returned by `GET /api/tags` as a tree: nested tags (`project/kalepin`) appear under their parent, each node shows its count, and nodes with children can be expanded. The section SHALL be hidden when the caller has no tags and SHALL refresh when notes change (WebSocket `flushed`, `file:changed`, `file:tree-update`, and opening another note).

#### Scenario: Nested tags render as a tree
- **GIVEN** the caller's visible notes carry `project` and `project/kalepin`
- **WHEN** the Tags section is expanded
- **THEN** `project` is shown with its count and expanding it reveals `kalepin` with its own count

#### Scenario: New tag appears after a save
- **GIVEN** the Tags section is visible
- **WHEN** the user types `#fresh` into a note and the note is flushed
- **THEN** `fresh` appears in the section without a page reload

### Requirement: Clicking a tag opens a tag search

Clicking a tag in the sidebar, or a tag pill in the top bar or the document header, SHALL open the search modal with its input prefilled with `tag:<tag>` and run that search. Opening the modal with ⌘K SHALL keep starting from an empty query.

#### Scenario: Sidebar tag click
- **WHEN** the user clicks `kalepin` under `project` in the Tags section
- **THEN** the search modal opens with the query `tag:project/kalepin` and lists the notes carrying that tag

#### Scenario: Pill click
- **GIVEN** the open note's frontmatter has `tags: [roadmap]`
- **WHEN** the user clicks the `#roadmap` pill in the top bar (or in the document header)
- **THEN** the search modal opens with the query `tag:roadmap`

### Requirement: Tag pills come from one frontmatter parser

The top bar and the document header SHALL derive their tag and status pills from a single frontmatter parser that accepts the same frontmatter shapes as the server (block list, flow list, scalar list, singular `tag:`, leading `#` stripped). Pills SHALL show frontmatter tags only; inline body tags are not repeated in the pill row.

#### Scenario: Block-list frontmatter shows pills
- **WHEN** the open note starts with `---\ntags:\n  - a\n  - b\n---`
- **THEN** pills for `a` and `b` are shown

### Requirement: Tag-only search results show recency

When the search modal shows results of a tag-only query, each result SHALL show the note's relative modified time in place of the relevance score.

#### Scenario: Tag-only result meta
- **WHEN** the search modal shows results for `tag:meeting`
- **THEN** each result shows a relative time such as `2h` instead of a score
