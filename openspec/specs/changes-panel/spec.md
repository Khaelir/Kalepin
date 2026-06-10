## Purpose

Toolbar icon, badge, and dropdown panel showing changes to notes since the user's last visit, with escalation for starred files and a separate mark-as-seen endpoint.

## Requirements

### Requirement: Toolbar icon with change badge
The main toolbar SHALL include a changes icon on the right side (near settings) that displays a numeric badge reflecting the count of distinct changed files since the user's `lastActiveAt`. The badge SHALL be hidden when there are no changes, and the icon SHALL be hidden or disabled for first-time users with no recorded changes.

#### Scenario: Badge shows file count
- **WHEN** five distinct files have changed (regardless of how many individual change records exist)
- **THEN** the badge SHALL show `5`

#### Scenario: No changes hides badge
- **WHEN** there are no changes since `lastActiveAt`
- **THEN** the badge SHALL be hidden

#### Scenario: Starred changes escalate style
- **WHEN** at least one changed file is in the user's starred set
- **THEN** the badge SHALL use the accent color and include a star indicator
- **AND** otherwise it SHALL use the default style

#### Scenario: Tooltip summarizes changes
- **WHEN** the user hovers the icon with changes present
- **THEN** the tooltip SHALL read `What's changed — N changes across M files since [relative date]`

#### Scenario: First-time user
- **WHEN** no changes have ever been recorded for the user
- **THEN** the icon SHALL be hidden or disabled

### Requirement: Dropdown panel lists changed files
Clicking the toolbar icon SHALL open a dropdown panel anchored below it, capped in height with internal scroll, showing a header with the since-date and summary stats and a list of changed files grouped into "Starred" and "Other changes" sections.

#### Scenario: Header content
- **WHEN** the panel opens with changes since a known date
- **THEN** the header SHALL show `Since [date] ([relative time])` followed by `N files · X created · Y modified · Z deleted`

#### Scenario: Starred section precedes other section
- **WHEN** at least one starred file has changes
- **THEN** the panel SHALL render a `★ Starred` section above an `Other changes` section
- **AND** the first diff in the Starred section SHALL be expanded while Other section diffs SHALL be collapsed

#### Scenario: Single section when no starred changes
- **WHEN** no starred file has changes
- **THEN** the panel SHALL render a single list without an empty Starred section

#### Scenario: File entry content
- **WHEN** a file entry renders for a modification
- **THEN** it SHALL show an action icon (`✎` modified, `+` created, `×` deleted), the clickable file name, the author's email or name, a relative timestamp, and an expandable diff with green additions and red deletions

#### Scenario: New file entry
- **WHEN** a file entry renders for a creation
- **THEN** it SHALL show `(new file — N lines)` in place of the diff

#### Scenario: Deleted file entry
- **WHEN** a file entry renders for a deletion
- **THEN** it SHALL show `(deleted)` with no expandable diff

#### Scenario: File name navigates to editor
- **WHEN** the user clicks a file name in the panel
- **THEN** the editor SHALL open that file

#### Scenario: Click outside closes without marking seen
- **WHEN** the panel is open and the user clicks outside of it
- **THEN** the panel SHALL close
- **AND** `lastActiveAt` SHALL NOT be updated

### Requirement: Mark all as seen action
The panel SHALL include a `Mark all as seen` button at the bottom that updates the user's `lastActiveAt` and clears the badge without re-fetching changes.

#### Scenario: Mark all as seen
- **WHEN** the user clicks `Mark all as seen`
- **THEN** the client SHALL call `POST /api/updates/mark-seen`
- **AND** the badge SHALL clear

### Requirement: Starred-file toast notifications on load
On application load, if any starred file has changed since `lastActiveAt`, the system SHALL surface up to three toasts — one per starred file — and aggregate the remainder into a single toast when more than three starred files have changed. Toasts SHALL auto-dismiss after five seconds and SHALL be manually dismissible.

#### Scenario: Up to three starred files
- **WHEN** two starred files have changed on page load
- **THEN** two toasts SHALL appear, each formatted `★ filename was [action] by [user] · [relative time]`

#### Scenario: More than three starred files
- **WHEN** five starred files have changed on page load
- **THEN** a single aggregate toast SHALL appear with text `★ 5 starred files changed`

#### Scenario: Toast dismissal
- **WHEN** a toast has been visible for five seconds without user interaction
- **THEN** it SHALL auto-dismiss
- **AND** the user SHALL be able to dismiss it manually at any time

### Requirement: File tree star toggle
Each file or folder row in the file tree SHALL reveal a `☆` icon on hover that toggles to `★` when the item is starred. Starred items SHALL keep `★` visible regardless of hover state, and stars SHALL persist via `POST /api/stars` and `DELETE /api/stars`.

#### Scenario: Toggle on
- **WHEN** the user hovers a non-starred item and clicks the `☆` icon
- **THEN** the client SHALL call `POST /api/stars` with that item's type and path
- **AND** the icon SHALL fill to `★`

#### Scenario: Toggle off
- **WHEN** the user clicks the `★` icon on a starred item
- **THEN** the client SHALL call `DELETE /api/stars` for that item
- **AND** the icon SHALL revert to `☆` (visible only on hover)

#### Scenario: Cap at five starred items
- **WHEN** the user already has five starred items and clicks `☆` on a sixth
- **THEN** the system SHALL NOT star the new item
- **AND** the UI SHALL show a tooltip `Maximum 5 starred items`

### Requirement: Updates data flow separates fetch from mark-seen
The client SHALL fetch changes via `GET /api/updates` on app load without updating `lastActiveAt`, SHALL call a separate `POST /api/updates/mark-seen` endpoint to clear the badge, and SHALL fetch stars via `GET /api/stars` on load and update them optimistically on toggle.

#### Scenario: Fetch does not clear badge
- **WHEN** the client calls `GET /api/updates`
- **THEN** the server SHALL return the change set
- **AND** it SHALL NOT update `lastActiveAt`

#### Scenario: Mark-seen updates lastActiveAt
- **WHEN** the client calls `POST /api/updates/mark-seen`
- **THEN** the server SHALL set `user.lastActiveAt = now()`
- **AND** it SHALL return without the changes payload

#### Scenario: Optimistic star toggle
- **WHEN** the user toggles a star
- **THEN** the UI SHALL reflect the new state immediately
- **AND** reconcile with the server response from `POST /api/stars` or `DELETE /api/stars`

### Requirement: API client methods
The web API client SHALL expose `getUpdates(since?)`, `markUpdatesSeen()`, `getStars()`, `addStar(type, path)`, and `removeStar(id)` methods with TypeScript signatures matching the updates and stars endpoints.

#### Scenario: getUpdates signature
- **WHEN** a caller invokes `getUpdates(since?)`
- **THEN** it SHALL return a `Promise<UpdatesResponse>` populated from `GET /api/updates`

#### Scenario: markUpdatesSeen signature
- **WHEN** a caller invokes `markUpdatesSeen()`
- **THEN** it SHALL return a `Promise<void>` from `POST /api/updates/mark-seen`

#### Scenario: Stars CRUD methods
- **WHEN** callers invoke `getStars()`, `addStar(type, path)`, or `removeStar(id)`
- **THEN** they SHALL return `Promise<StarredItem[]>`, `Promise<StarredItem>`, and `Promise<void>` respectively, backed by the corresponding stars endpoints
