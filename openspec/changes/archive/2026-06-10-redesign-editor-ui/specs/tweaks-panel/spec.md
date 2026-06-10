## ADDED Requirements

### Requirement: Tweaks panel UI
The system SHALL provide a floating "Tweaks" panel accessible from the top bar's overflow menu or a toolbar toggle. The panel MUST be 320px wide with 10px radius and `--kalepin-box-shadow-lg`, anchored to the bottom-right of the viewport.

#### Scenario: Open tweaks
- **WHEN** the user clicks the Tweaks affordance
- **THEN** the panel slides in at the bottom-right

#### Scenario: Close tweaks
- **WHEN** the user clicks outside the panel or presses Escape
- **THEN** the panel hides

### Requirement: Theme toggle
The panel SHALL include a segmented control to switch between Light and Dark themes. Selecting a theme SHALL apply `html[data-theme='<value>']` immediately and persist the choice.

#### Scenario: Switch to light
- **WHEN** the user clicks "Light"
- **THEN** the app repaints in light theme and `localStorage.kalepin-tweaks.theme` becomes `"light"`

### Requirement: Accent color swatches
The panel SHALL expose five accent-color swatches: Orange, Blue, Green, Purple, Rose. Selecting one SHALL update `html[data-accent]` and persist.

#### Scenario: Select purple
- **WHEN** the user clicks the Purple swatch
- **THEN** `html[data-accent='purple']` is applied and all primary-colored elements update

### Requirement: Density segmented control
The panel SHALL expose Compact / Comfortable / Spacious choices, driving `html[data-density]`.

#### Scenario: Select compact
- **WHEN** the user selects Compact
- **THEN** row padding shrinks and editor max-width becomes 720px, without remounting the editor

### Requirement: Editor font toggle
The panel SHALL expose a toggle between Serif (Source Serif 4) and Sans (Lato) for the editor prose.

#### Scenario: Switch font
- **WHEN** the user selects Sans
- **THEN** `.kp-prose` content repaints in Lato; UI chrome is unaffected

### Requirement: Layout toggles
The panel SHALL include on/off switches for Sidebar, Right rail, and Mini-map visibility.

#### Scenario: Hide sidebar
- **WHEN** the user toggles Sidebar off
- **THEN** the sidebar column collapses and the editor expands to fill the freed space

#### Scenario: Hide mini-map
- **WHEN** the user toggles Mini-map off
- **THEN** the floating mini-map stops rendering

### Requirement: Persistence and migration
Tweak state SHALL be persisted to `localStorage['kalepin-tweaks']` as a JSON object with a `version` field. On first load after this change ships, the system SHALL migrate the legacy `kalepin-theme` key into the new object and then delete the legacy key.

#### Scenario: Reload preserves choices
- **WHEN** the user selects Purple, Compact, Dark, Sans, sidebar-off, then reloads the tab
- **THEN** after reload, all those settings are still applied

#### Scenario: Legacy theme migrated
- **WHEN** a user who previously set `localStorage['kalepin-theme'] = 'light'` loads the app for the first time after this change
- **THEN** the new tweaks object has `theme: 'light'` and the legacy key is removed
