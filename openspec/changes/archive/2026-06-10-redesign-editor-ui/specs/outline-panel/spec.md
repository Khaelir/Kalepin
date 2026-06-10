## ADDED Requirements

### Requirement: Outline tab in right rail
The right rail SHALL include an "Outline" tab that renders the current document's headings (H2 and H3) as a nested list. Clicking a heading SHALL scroll the doc to that heading.

#### Scenario: Headings listed
- **WHEN** a document has headings
- **THEN** the Outline tab shows them in document order, with H3s indented under their parent H2

#### Scenario: Click a heading
- **WHEN** the user clicks a heading in the outline
- **THEN** the doc scrolls that heading to the top of the viewport

#### Scenario: No headings
- **WHEN** the document has no headings
- **THEN** the Outline tab shows an empty-state message (e.g., "No headings in this document")

### Requirement: Currently-visible heading indicator
The Outline tab SHALL track the currently-visible heading (the topmost heading whose bottom edge is above the viewport's center line) and render it in bold with a `--kalepin-primary` dot.

#### Scenario: Scrolling updates the active heading
- **WHEN** the user scrolls past a heading
- **THEN** that heading becomes the active one in the outline (bolded + dot)

#### Scenario: Outline updates when the doc changes
- **WHEN** the user adds a new heading to the doc
- **THEN** the outline updates to include it within the next render cycle
