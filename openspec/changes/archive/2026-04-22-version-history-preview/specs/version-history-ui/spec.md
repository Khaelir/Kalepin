## REMOVED Requirements

### Requirement: Diff comparison view
**Reason**: Replaced by full document preview in the editor. Diff view was developer-oriented and not intuitive for end users.
**Migration**: Users view the full reconstructed document in the editor instead of a line-level diff in the panel.

## MODIFIED Requirements

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
