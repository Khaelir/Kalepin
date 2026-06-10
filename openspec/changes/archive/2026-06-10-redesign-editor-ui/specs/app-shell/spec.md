## ADDED Requirements

### Requirement: Five-area grid layout
The app SHALL render a CSS-grid shell with five named areas: a top bar, a left sidebar, a center editor area, a right rail, and a bottom status bar. The grid template MUST be `grid-template-columns: 260px 1fr 320px` and `grid-template-rows: 52px 1fr 28px`, with the top bar and status bar spanning all three columns.

#### Scenario: Default layout dimensions
- **WHEN** the app loads with default tweaks
- **THEN** the top bar is 52px tall and full-width, the sidebar is 260px wide, the right rail is 320px wide, and the status bar is 28px tall and full-width

#### Scenario: Editor fills the remaining space
- **WHEN** the browser window is resized wider or narrower
- **THEN** the editor column expands or contracts, while sidebar and rail remain fixed

### Requirement: Column and row collapse
The system SHALL collapse the sidebar, right rail, or status bar when the corresponding tweak toggle (`tweak.sidebar`, `tweak.rail`, …) is off — setting that area's size to `0` via a modified `grid-template-columns` or `grid-template-rows`, without unmounting its children.

#### Scenario: Sidebar hidden
- **WHEN** `tweak.sidebar` is `false`
- **THEN** the grid's first column collapses to `0` and the editor column expands to fill the freed space

#### Scenario: Right rail hidden
- **WHEN** `tweak.rail` is `false`
- **THEN** the grid's third column collapses to `0` and the editor expands

#### Scenario: Reopening a hidden column
- **WHEN** the user re-enables a hidden column
- **THEN** the column re-expands to its width with the same children visible, without refetching data

### Requirement: Single source of truth for shell state
The shell layout SHALL derive its visible/hidden columns from a single `tweak` state object, so toggling from the tweaks panel immediately updates the grid without remounting editor content.

#### Scenario: Tweak change does not remount editor
- **WHEN** the user toggles `tweak.rail` off and then on
- **THEN** the TipTap editor instance in the center column retains its state (no reload, no scroll reset)
