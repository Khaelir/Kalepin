## ADDED Requirements

### Requirement: Gutter strip visibility
The editor SHALL display a gutter strip alongside the scrollbar when the document content exceeds the visible area (i.e., `scrollHeight > clientHeight`). The gutter strip SHALL NOT be rendered when the document fits within the viewport without scrolling.

#### Scenario: Long document shows gutter
- **WHEN** a document is opened whose content height exceeds the editor container's visible height
- **THEN** a thin gutter strip is rendered on the right edge of the editor container

#### Scenario: Short document hides gutter
- **WHEN** a document is opened whose content fits entirely within the editor container
- **THEN** no gutter strip is rendered

#### Scenario: Document grows beyond viewport
- **WHEN** content is added to a short document causing it to exceed the visible height
- **THEN** the gutter strip appears

#### Scenario: Document shrinks below viewport
- **WHEN** content is removed from a long document so it no longer exceeds the visible height
- **THEN** the gutter strip disappears

### Requirement: Markers for unresolved comments only
The gutter strip SHALL display a pill marker for each unresolved comment thread that has a resolvable position in the document. Resolved comment threads SHALL NOT have markers.

#### Scenario: Unresolved thread shows marker
- **WHEN** the document has an unresolved comment thread with `quotedText` that matches text in the document
- **THEN** a pill marker is displayed in the gutter at the vertical position corresponding to that thread's location in the document

#### Scenario: Resolved thread has no marker
- **WHEN** a comment thread has `resolved: true`
- **THEN** no pill marker is displayed for that thread

#### Scenario: Thread with no matching text has no marker
- **WHEN** an unresolved comment thread's `quotedText` cannot be found in the document (e.g., the text was deleted)
- **THEN** no pill marker is displayed for that thread

### Requirement: Marker position reflects document position
Each pill marker SHALL be positioned vertically in the gutter to correspond proportionally to the comment's position within the full document height. The position SHALL be computed as the ratio of the comment's vertical offset from the top of the document to the total scrollable height.

#### Scenario: Comment at top of document
- **WHEN** a comment is located near the beginning of the document
- **THEN** its marker appears near the top of the gutter strip

#### Scenario: Comment at bottom of document
- **WHEN** a comment is located near the end of the document
- **THEN** its marker appears near the bottom of the gutter strip

### Requirement: Mention distinction
Pill markers for threads where any comment mentions the current user's email SHALL be visually distinct from markers for threads with no mention of the current user. Mention markers SHALL use a stronger opacity (`rgba(233, 69, 96, 0.85)`) while regular markers SHALL use a softer opacity (`rgba(233, 69, 96, 0.35)`).

#### Scenario: Thread mentions current user
- **WHEN** an unresolved thread contains a comment with `@[Any Name](current-user@example.com)` and the logged-in user's email is `current-user@example.com`
- **THEN** the marker for that thread uses the strong rose color

#### Scenario: Thread does not mention current user
- **WHEN** no comment in an unresolved thread contains the current user's email in a mention
- **THEN** the marker for that thread uses the soft rose color

#### Scenario: Mention in any comment of thread counts
- **WHEN** a thread has multiple comments and the current user is mentioned in the second reply (not the first comment)
- **THEN** the marker for that thread still uses the strong rose color

### Requirement: Click to navigate
Clicking a pill marker SHALL navigate the editor to the comment's position in the document, selecting and scrolling to the highlighted text.

#### Scenario: Click marker navigates to comment
- **WHEN** a user clicks a pill marker in the gutter
- **THEN** the editor scrolls to the corresponding comment's highlighted text and selects it

### Requirement: Position recalculation
Marker positions SHALL be recalculated when comment threads change, document content changes, or the editor container is resized.

#### Scenario: New comment triggers recalculation
- **WHEN** a new unresolved comment thread is added
- **THEN** a new marker appears at the correct position and existing markers remain accurate

#### Scenario: Content edit shifts markers
- **WHEN** text is inserted above an existing comment, pushing it further down the document
- **THEN** the marker's position in the gutter updates to reflect the new location

#### Scenario: Window resize updates markers
- **WHEN** the browser window or editor container is resized
- **THEN** marker positions are recalculated to remain proportionally correct
