# version-history-ui Specification

## Purpose
TBD - created by archiving change version-history. Update Purpose after archive.
## Requirements
### Requirement: Version history toolbar button
The editor toolbar SHALL include a button to open the version history panel for the currently open note.

#### Scenario: Button visible when a note is open
- **WHEN** a user has a note open in the editor
- **THEN** a version history icon (clock/history icon) is visible in the toolbar

#### Scenario: Button disabled when no note is open
- **WHEN** no note is open in the editor
- **THEN** the version history button is disabled or hidden

### Requirement: Version history timeline panel
The system SHALL display a sidebar panel showing the chronological list of changes for the current note.

#### Scenario: Panel opens with change list
- **WHEN** the user clicks the version history toolbar button
- **THEN** a right sidebar panel opens showing a list of changes, each displaying the user who made it, a relative timestamp (e.g., "2 hours ago"), and the action type (created/modified)

#### Scenario: Panel shows empty state
- **WHEN** the user opens version history for a note with no recorded changes
- **THEN** the panel displays a message indicating no history is available

#### Scenario: Panel closes
- **WHEN** the user clicks the version history button again or clicks a close button on the panel
- **THEN** the panel closes and the editor returns to its normal layout

#### Scenario: Panel replaces other sidebar panels
- **WHEN** the comments panel is open and the user opens version history
- **THEN** the version history panel replaces the comments panel (only one sidebar panel open at a time)

### Requirement: View historical version
The system SHALL allow users to view any historical version as read-only rendered content directly in the editor area (not in a separate panel section).

#### Scenario: Click a history entry to preview
- **WHEN** the user clicks on a change entry in the history timeline
- **THEN** the editor area shows the reconstructed content at that point in time, rendered in read-only mode via TipTap
- **AND** a visual indicator (banner) shows that the user is viewing a historical version, not the current document

#### Scenario: Return to current version
- **WHEN** the user is viewing a historical version and closes the version history panel
- **THEN** the editor returns to the live current document with full editing capabilities

### Requirement: Restore action from history panel
The system SHALL allow users to restore a historical version from the history panel, with automatic preservation of the current state.

#### Scenario: Restore button on historical version view
- **WHEN** the user is viewing a historical version
- **THEN** a "Restore this version" button is visible in the version history panel

#### Scenario: Confirm and execute restore
- **WHEN** the user clicks "Restore this version"
- **THEN** a confirmation prompt appears warning that the current content will be replaced
- **AND** upon confirmation, the current content is auto-snapshotted, then the historical content replaces the current document content via OT
- **AND** the editor returns to live editing mode with the restored content
- **AND** the version history panel refreshes to show the new entries

#### Scenario: Restore reflected in history
- **WHEN** a version is restored
- **THEN** the restore appears as a new entry in the version history timeline
- **AND** the pre-restore content is preserved as a separate entry in history

