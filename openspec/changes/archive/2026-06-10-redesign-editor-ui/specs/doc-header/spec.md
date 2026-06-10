## ADDED Requirements

### Requirement: Doc-header block above prose
The editor SHALL render a document-header block above the prose, inside the same scrollable container, containing: a path breadcrumb, an editable title, an optional subtitle, an inline tag row, and a meta row.

#### Scenario: Header renders above prose
- **WHEN** a document is opened
- **THEN** the doc header is rendered at the top of the scroll area, above the first block of prose

#### Scenario: Header scrolls with the doc
- **WHEN** the user scrolls the doc
- **THEN** the header scrolls out of view with the rest of the content (it is NOT sticky)

### Requirement: Editable title
The title SHALL be a contenteditable element rendered at 32px, weight 700, using `--kalepin-text-default`. The title must show a text cursor on hover and gain a focus ring when focused. Editing the title SHALL rename the underlying file on blur (or on enter).

#### Scenario: Hover the title
- **WHEN** the user hovers the title
- **THEN** the cursor changes to the text I-beam

#### Scenario: Edit the title
- **WHEN** the user edits the title and blurs the field
- **THEN** the file is renamed via the existing `moveFile` API, and the URL, breadcrumb, and sidebar row all update

#### Scenario: Empty title rejected
- **WHEN** the user clears the title and blurs
- **THEN** the previous title is restored and a toast is shown

### Requirement: Subtitle and tag row
The doc-header SHALL display (optional) a subtitle at 16px `--kalepin-text-secondary` and a tag row showing inline tags and any status pill, matching the top-bar tag styling.

#### Scenario: Subtitle hidden when empty
- **WHEN** the document has no subtitle
- **THEN** the subtitle element is not rendered (no empty space)

#### Scenario: Tags match top bar
- **WHEN** the doc has tags
- **THEN** each tag in the header renders identically to the top-bar tag (same font, color, padding)

### Requirement: Meta row
The doc-header SHALL display a meta row below the tags with the author avatar, author name, edited-at relative time, read time, word count, and backlink count, separated by middle-dots.

#### Scenario: Meta rendering
- **WHEN** a document has been edited by `alex@example.com` 2 minutes ago, and has 712 words and 4 backlinks
- **THEN** the meta row reads `[avatar] Alex · edited 2 minutes ago · 4 min read · 712 words · 4 backlinks`

### Requirement: Presence gutter
The doc-header SHALL render up to four presence avatars floating in the left gutter, vertically offset 40px from the top of the title, showing the users currently viewing the document.

#### Scenario: Presence avatars align to the title
- **WHEN** three users are viewing the doc
- **THEN** three 24px avatars are stacked in the left gutter beside the title area

#### Scenario: Clicking a gutter avatar scrolls to that user
- **WHEN** the user clicks a gutter avatar
- **THEN** the editor scrolls to that user's cursor position (using the existing `scrollToUser` handle)
