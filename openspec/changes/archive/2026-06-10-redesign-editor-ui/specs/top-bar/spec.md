## ADDED Requirements

### Requirement: Top bar structure
The system SHALL render a 52px-tall top bar spanning the full width of the app above the sidebar and editor, divided into: workspace switcher (left), breadcrumb path with inline tags (center-left), tab pill (center-right), presence stack (right), and action cluster (far right: search, share, overflow).

#### Scenario: Top bar always visible
- **WHEN** the app is in any workspace view
- **THEN** the top bar is rendered at the top of the viewport

#### Scenario: Top bar hidden in full-page views
- **WHEN** the user is on the Settings page or Graph view full-screen
- **THEN** the top bar remains visible (it is the app shell), only the center column swaps

### Requirement: Workspace switcher
The workspace switcher SHALL display the Kalepin brand mark plus the workspace name "Kalepin vault" (or user-configured). A chevron-down affordance is shown only if more than one workspace exists.

#### Scenario: Single workspace (current)
- **WHEN** the user has only the default workspace
- **THEN** the switcher renders the brand mark and workspace name as non-interactive text (no chevron)

#### Scenario: Hover state
- **WHEN** the user hovers the workspace switcher
- **THEN** the switcher shows a hover background using `--kalepin-bg-hover`

### Requirement: Breadcrumb path
The top bar SHALL display the current document's path as middle-dot-separated segments, with all segments using `--kalepin-text-secondary` except the final segment, which uses `--kalepin-text-default`.

#### Scenario: Open a nested document
- **WHEN** the user opens a file at path `Engineering/RFCs/001 — Realtime.md`
- **THEN** the breadcrumb renders as `Engineering · RFCs · 001 — Realtime` with the final segment bolder/darker than the preceding ones

#### Scenario: Click a breadcrumb segment
- **WHEN** the user clicks a non-final breadcrumb segment
- **THEN** the sidebar expands to the corresponding folder (navigation reserved; no route change)

### Requirement: Inline tags and status pill
The top bar SHALL render the current document's frontmatter tags (each as `#tagname`) and, when the document has a status tag, a status pill with `--kalepin-color-warning-fade` background and `--kalepin-color-warning` text.

#### Scenario: Document with tags
- **WHEN** the open document has tags `rfc` and `engineering` in frontmatter
- **THEN** `#rfc` and `#engineering` appear inline after the breadcrumb

#### Scenario: Document with status
- **WHEN** the document has a status such as `in-review`
- **THEN** a pill with the status text appears next to the tags with 6px radius and 20px height

### Requirement: Tab pill
The top bar SHALL include a horizontal pill group with tabs for the current view mode. Active tab uses `--kalepin-primary-fade-12` background and `--kalepin-primary` text; inactive tabs use `--kalepin-text-secondary`.

#### Scenario: Active view indicated
- **WHEN** the user is in edit view
- **THEN** the "Edit" tab renders with the active styling

#### Scenario: Click a tab
- **WHEN** the user clicks an inactive tab
- **THEN** the view switches accordingly (e.g., "History" opens the version history rail tab)

### Requirement: Presence stack
The top bar SHALL display a stack of up to 4 visible 24px avatar circles for users currently viewing the document, with a "+N" bubble after that. Each avatar MUST have a 2px ring in the user's color and show a hover card with the user's name and "editing on line X" on hover.

#### Scenario: Three users present
- **WHEN** three users are actively viewing the current document
- **THEN** three 24px avatar circles appear in the top-right area, each with a 2px user-color ring

#### Scenario: Six users present
- **WHEN** six users are viewing
- **THEN** four avatars are shown followed by a "+2" bubble

#### Scenario: Avatar hover card
- **WHEN** the user hovers a presence avatar
- **THEN** a card pops up showing the user's email/name

### Requirement: Action cluster
The top bar SHALL include action buttons on the far right: a search button (with magnifier icon and "⌘K" kbd hint), a primary-styled share button, and an overflow menu button.

#### Scenario: Click search
- **WHEN** the user clicks the search button (or presses ⌘K)
- **THEN** the search modal opens

#### Scenario: Click share
- **WHEN** the user clicks share
- **THEN** the existing share-link flow opens (creates a `/d/<code>` link and shows the copy affordance)
