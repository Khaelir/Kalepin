## ADDED Requirements

### Requirement: Status bar structure
The system SHALL render a 28px-tall status bar spanning the full width of the app at the bottom of the viewport, with 12px horizontal padding, `--kalepin-bg-elevated` background, a 1px top border, and 12px muted text.

#### Scenario: Status bar always visible when a doc is open
- **WHEN** a document is open
- **THEN** the status bar is rendered at the bottom of the grid

### Requirement: Left-side indicators
The status bar's left region SHALL display (in order): a sync status dot (green when synced, amber when syncing, red when disconnected), a "Synced · rev N" label using the current OT revision, a "Saved to disk" indicator driven by the existing save-status signal, and "N collaborator(s) connected" using the presence count.

#### Scenario: Synced state
- **WHEN** the WebSocket is connected and the document has no pending ops
- **THEN** the left region shows a green dot, the current revision number, and "Saved to disk"

#### Scenario: Syncing state
- **WHEN** the client has a pending OT op not yet acknowledged
- **THEN** the sync dot is amber and the revision label is suffixed with "…"

#### Scenario: Disconnected state
- **WHEN** the WebSocket is disconnected
- **THEN** the sync dot is red and the label reads "Disconnected"

#### Scenario: Collaborator count
- **WHEN** two other users are present on the same document
- **THEN** the left region shows "3 collaborators connected" (including the current user) — or matches the presence list length

### Requirement: Right-side doc metadata
The status bar's right region SHALL display doc metadata: file format (`Markdown`), encoding (`UTF-8`), line ending (`LF` or `CRLF`), and word count.

#### Scenario: Word count updates
- **WHEN** the user edits the document
- **THEN** the word count updates after a short debounce (≤ 500ms)

#### Scenario: No doc open
- **WHEN** no document is open
- **THEN** the right region is empty (but the bar is still rendered)
