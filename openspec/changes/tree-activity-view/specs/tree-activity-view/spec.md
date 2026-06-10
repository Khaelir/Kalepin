## ADDED Requirements

### Requirement: Sidebar mode toggle
The sidebar SHALL render a two-option segmented control in the sidebar head labeled `Vault` and `Activity`. Selecting a mode changes what the sidebar body renders — `Vault` renders the existing file tree, `Activity` renders a flat recency-grouped file listing. The selected mode SHALL persist to `localStorage['kalepin-tweaks'].sidebarMode` (values `'vault' | 'activity'`, default `'vault'`).

#### Scenario: Toggle to Activity mode
- **WHEN** the user clicks `Activity` in the sidebar-head segmented control
- **THEN** the sidebar body replaces the Vault tree with the Activity view, the `Activity` option renders with the primary-fade background and primary-color text, and `tweak.sidebarMode` is updated to `'activity'`

#### Scenario: Mode persists across reloads
- **WHEN** the user has previously selected `Activity` mode and reloads the page
- **THEN** the sidebar renders in `Activity` mode on mount, reading from `tweak.sidebarMode`

#### Scenario: First-time default
- **WHEN** a user loads the app with no `sidebarMode` value in `localStorage['kalepin-tweaks']`
- **THEN** the sidebar renders in `Vault` mode

### Requirement: Activity-view bucket grouping
In `Activity` mode the sidebar body SHALL render a flat list of all markdown files in the vault, grouped into recency buckets using the file's `mtimeMs` and the client's local timezone. Buckets MUST appear in this order and MUST render a bucket header only when at least one file falls into the bucket: `Today`, `Yesterday`, `Earlier this week`, `Earlier this month`, `Older`. Within each bucket, files MUST be sorted by `mtimeMs` descending (most-recent first).

#### Scenario: Bucket boundaries
- **WHEN** bucketing a file with `mtimeMs = M` and the current time is `now` in the user's local timezone
- **THEN** the file falls into `Today` if `M >= startOfToday(now)`, else `Yesterday` if `M >= startOfToday(now) - 86_400_000`, else `Earlier this week` if `M >= startOfIsoWeek(now)`, else `Earlier this month` if `M >= startOfMonth(now)`, else `Older`

#### Scenario: Empty bucket is hidden
- **WHEN** no file in the vault has `mtimeMs` in the `Yesterday` range
- **THEN** the `Yesterday` header is not rendered

#### Scenario: Future mtime is clamped to Today
- **WHEN** a file reports `mtimeMs > Date.now()` (clock skew, restored archive)
- **THEN** the bucketing helper clamps `mtimeMs` to `Date.now()` before grouping, placing the file in `Today`

#### Scenario: Older bucket cap
- **WHEN** more than 500 files fall into the `Older` bucket
- **THEN** only the 500 most-recently-modified `Older` entries render by default, followed by a `Show N more` control that reveals the rest on click

### Requirement: Activity-view row rendering
Each Activity-view row SHALL render using the existing `.kp-node` sidebar row styling, showing: the document icon, the document name (without the `.md` extension), and a right-aligned relative-time label derived from `mtimeMs`. Clicking a row SHALL open the document (same behavior as a Vault-tree click).

#### Scenario: Row renders with relative time
- **WHEN** a file was modified 2 hours ago
- **THEN** the row's right-aligned meta reads `2h ago` (matching the format used by `RecentSection`)

#### Scenario: Row click opens the document
- **WHEN** the user clicks an Activity-view row for path `projects/syren/notes.md`
- **THEN** the editor opens `projects/syren/notes.md` — identical behavior to clicking the same file in the Vault tree

#### Scenario: Active document is highlighted
- **WHEN** the currently-open document is `projects/syren/notes.md` and that file also appears in the Activity view
- **THEN** the Activity-view row for that path renders with the `.is-active` state (primary-fade background, primary-color text, 2px left border)

### Requirement: Activity-view empty state
When the vault contains zero markdown files OR the file-listing has not yet loaded, the Activity view SHALL render an empty-state card instead of bucket headers. The card SHALL use `--kalepin-bg-elevated` background, `--kalepin-border-color` 1px border, and display a muted caption appropriate to the state.

#### Scenario: Empty vault
- **WHEN** the file tree loads and contains no markdown files
- **THEN** the Activity view renders a card reading `No recent activity`

#### Scenario: Loading state
- **WHEN** the file tree has not yet loaded on mount
- **THEN** the Activity view renders a card reading `Loading…` (no spinner required)

### Requirement: Vault-tree row hover tooltip
In `Vault` mode, hovering any file row in the tree SHALL display a native `title` tooltip showing the file's relative modification time (e.g., `updated 2h ago`). The tooltip MUST NOT change row layout, height, or visible meta; directories are exempt.

#### Scenario: File row tooltip
- **WHEN** the user hovers a file row whose `mtimeMs` is 2 hours before now
- **THEN** the native browser tooltip reads `updated 2h ago`

#### Scenario: Directory row has no tooltip
- **WHEN** the user hovers a directory row
- **THEN** no tooltip is shown
