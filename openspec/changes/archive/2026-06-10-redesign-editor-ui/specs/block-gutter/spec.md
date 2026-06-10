## ADDED Requirements

### Requirement: Hover-revealed block gutter
Each top-level block in the editor prose SHALL reveal a left-gutter control cluster when the block is hovered or focused. The cluster SHALL contain a drag handle (material `drag_indicator` glyph) and a plus button (material `add` glyph), positioned 28px to the left of the block's left edge.

#### Scenario: Hover a paragraph
- **WHEN** the pointer enters a paragraph's bounding box
- **THEN** the drag handle and plus button fade in in the left gutter at that paragraph's vertical level

#### Scenario: Leave hover
- **WHEN** the pointer leaves the block and does not enter the gutter cluster
- **THEN** the gutter cluster fades out

#### Scenario: Keyboard focus
- **WHEN** the caret is placed inside a block
- **THEN** the gutter cluster is shown at that block (as if hovered)

### Requirement: Drag handle opens slash menu
Clicking the drag handle SHALL open the slash menu anchored to the right of the block, as if the user had typed `/` at the start of the block.

#### Scenario: Click drag handle
- **WHEN** the user clicks the drag handle on an empty paragraph
- **THEN** the slash menu opens with the caret positioned at that paragraph

### Requirement: Add button inserts paragraph
Clicking the plus button SHALL insert a new empty paragraph immediately below the current block and move the caret into the new paragraph.

#### Scenario: Add below a heading
- **WHEN** the user clicks the plus button next to an H2
- **THEN** a new paragraph is inserted directly below the heading and the caret lands in it

### Requirement: Drag-to-reorder reserved
In v1, the drag handle SHALL respond only to click (opening the slash menu). Press-and-drag interactions MUST NOT trigger any block reordering or side effect; drag-to-reorder is reserved for a future change.

#### Scenario: Drag-to-reorder not wired in v1
- **WHEN** the user press-and-drags the drag handle in v1
- **THEN** no reorder occurs — only clicking opens the slash menu

### Requirement: Gutter does not shift layout
The gutter controls SHALL be absolutely positioned so that revealing them on hover does not reflow the prose column.

#### Scenario: No layout shift on hover
- **WHEN** the user hovers over a block
- **THEN** the prose text does not move horizontally or vertically
