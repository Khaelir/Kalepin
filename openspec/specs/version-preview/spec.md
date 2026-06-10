# version-preview Specification

## Purpose
TBD - created by archiving change version-history-preview. Update Purpose after archive.
## Requirements
### Requirement: Read-only document preview for historical versions
When a user selects a historical version from the timeline, the editor SHALL display the reconstructed document content in read-only mode using TipTap's `editable: false`, replacing the live document view.

#### Scenario: Select a version to preview
- **WHEN** the user clicks a change entry in the version history timeline
- **THEN** the editor displays the reconstructed content for that version in read-only mode
- **AND** a banner is visible indicating the user is viewing a historical version (including the timestamp)

#### Scenario: Swap between versions
- **WHEN** the user clicks a different change entry while already previewing a version
- **THEN** the editor content swaps to the newly selected version's reconstructed content without leaving preview mode

#### Scenario: Visual treatment in preview mode
- **WHEN** the editor is displaying a historical version
- **THEN** the editor area SHALL have a visually distinct treatment (reduced opacity or dimmed styling) to clearly differentiate it from live editing mode
- **AND** keypresses and input SHALL be ignored (TipTap `editable: false`)

### Requirement: Return to live editing on panel close
When the version history panel is closed without a restore having been performed, the editor SHALL return to the current live document with full editing capabilities.

#### Scenario: Close panel while previewing
- **WHEN** the user closes the version history panel while viewing a historical version
- **THEN** the editor restores the current live document content
- **AND** the editor returns to `editable: true` mode

#### Scenario: Close panel after restore
- **WHEN** the user restores a version and then closes the panel
- **THEN** the editor shows the restored content (which is now the live document) in `editable: true` mode

