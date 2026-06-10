## ADDED Requirements

### Requirement: Collapsed mini-map strip
The editor SHALL render a 12px-wide vertical strip anchored to the right edge of the editor scroll area, showing horizontal ticks (one per heading, 16px × 2px, `--kalepin-text-light` at opacity 0.45), a soft viewport indicator (8% opacity, `--kalepin-primary`), and comment markers (4px-wide dashes in `--kalepin-primary` for unresolved, `--kalepin-text-light` at opacity 0.4 for resolved).

#### Scenario: Document with headings
- **WHEN** a document has multiple H2/H3 headings
- **THEN** each heading gets a tick on the strip at the vertical position proportional to its offset

#### Scenario: Document with no headings
- **WHEN** a document has no headings
- **THEN** only the viewport indicator is visible (no ticks)

#### Scenario: Viewport indicator tracks scroll
- **WHEN** the user scrolls the doc
- **THEN** the viewport indicator moves vertically in proportion to `scrollTop / scrollHeight`

### Requirement: Comment markers
The mini-map SHALL show a dash marker for each comment thread that has a resolvable position in the document. Unresolved markers use `--kalepin-primary`; resolved markers use muted styling.

#### Scenario: Unresolved comment shows marker
- **WHEN** an unresolved thread's `quotedText` matches text in the document
- **THEN** a 4px-wide dash appears at the corresponding vertical position on the strip

#### Scenario: Resolved comment shows muted marker
- **WHEN** a thread is resolved
- **THEN** its marker remains visible but uses `--kalepin-text-light` at 0.4 opacity

#### Scenario: Comment with unresolvable position
- **WHEN** a thread's quoted text no longer exists in the doc
- **THEN** no marker is shown for that thread

### Requirement: Expanded on hover
When the user hovers the mini-map strip, the strip SHALL expand to 220px wide over 180ms with ease-out, turning into a vertical list of heading labels and expanded comment flags.

#### Scenario: Hover expands
- **WHEN** the user hovers the strip
- **THEN** the strip animates to 220px wide and shows heading labels and comment flags

#### Scenario: Current heading highlighted
- **WHEN** the mini-map is expanded and the user's scroll position is under heading X
- **THEN** X's label is bold with `--kalepin-primary` color and a 4px left accent bar

#### Scenario: Click a heading
- **WHEN** the user clicks a heading label
- **THEN** the doc scrolls that heading into view

#### Scenario: Click a comment flag
- **WHEN** the user clicks a comment flag
- **THEN** `focusThread(id)` is invoked — the right rail switches to the Comments tab, scrolls the thread into view, and the thread pulses for 1400ms

### Requirement: Accurate heading offsets via offsetParent walk
The mini-map's heading-position math SHALL walk the `offsetParent` chain (not use `offsetTop` alone) to compute each heading's true offset within the scroll container, accounting for nested `position: relative` ancestors (e.g., paragraphs containing gutter handles).

#### Scenario: Nested positioned ancestors
- **WHEN** a heading's parent paragraph has `position: relative`
- **THEN** the tick for that heading is placed at the correct absolute vertical position (not shifted by the parent's top)

### Requirement: Hidden when mini-map tweak off or version preview active
The mini-map SHALL not render when `tweak.minimap` is `false` or when a historical version preview is active.

#### Scenario: Tweak disables the mini-map
- **WHEN** `tweak.minimap` is `false`
- **THEN** the strip is not rendered and its expanded hover cannot be triggered

#### Scenario: Version preview hides the mini-map
- **WHEN** the user is previewing a historical version
- **THEN** the mini-map is hidden to avoid confusing interactions with the historical content
