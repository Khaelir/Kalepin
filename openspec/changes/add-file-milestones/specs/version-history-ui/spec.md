## ADDED Requirements

### Requirement: Milestones section in the version history panel
The version history panel SHALL render a `Milestones` section above the chronological history list. The section SHALL list the milestones for the currently open document, ordered by `createdAt` descending, each row showing the milestone name, optional description (truncated), the creator's email, and a relative-time label.

#### Scenario: Section renders for a file with milestones
- **WHEN** the user opens version history on a file that has two milestones
- **THEN** the panel renders a `Milestones` group above the chronological list with two rows, in `createdAt` DESC order

#### Scenario: Section is hidden when no milestones exist
- **WHEN** the user opens version history on a file that has no milestones
- **THEN** the `Milestones` section header is not rendered; an inline empty hint reading `No milestones yet — pick a version below or save the current state.` is shown at the top of the panel

#### Scenario: Active milestone preview is highlighted
- **WHEN** the user is previewing a milestone
- **THEN** that milestone's row in the section renders with the active state (primary-fade background, primary-color text)

### Requirement: Save current state as milestone (toolbar action)
The editor SHALL expose a `Save current state as milestone…` action in the same surface that hosts the version history button. Clicking the action SHALL force-flush any pending OT edits to disk and ONLY THEN open the milestone naming dialog. The milestone created from this action SHALL anchor to the `note_changes` row produced by that flush, guaranteeing every toolbar-created milestone corresponds to a state that exists in the regular history chain.

#### Scenario: Toolbar action flushes before opening the dialog
- **WHEN** the user has unflushed edits and clicks `Save current state as milestone…` in the editor
- **THEN** the OT layer flushes the pending edits, a new `note_changes` row is recorded, and the naming dialog opens after the flush completes

#### Scenario: Toolbar action with no pending edits
- **WHEN** the user clicks `Save current state as milestone…` and the editor has no pending edits
- **THEN** the dialog opens immediately (no flush needed) and the milestone anchors to the most-recent existing `note_changes` row for the path

#### Scenario: Flush failure aborts the action
- **WHEN** the user clicks `Save current state as milestone…` and the OT flush fails
- **THEN** the naming dialog does NOT open, the flush error is surfaced to the user, and no milestone row is created

#### Scenario: Successful creation closes the dialog and updates the panel
- **WHEN** the user submits a valid `name` in the naming dialog
- **THEN** the dialog closes and the new milestone appears at the top of the `Milestones` section in the version history panel

#### Scenario: Duplicate name shows inline error
- **WHEN** the user submits a `name` that already exists for the current path
- **THEN** the dialog stays open, the `name` field shows an inline error reading `A milestone named "<name>" already exists for this file`, and no row is created

### Requirement: Save as milestone from a history row
Each row in the chronological history list SHALL offer a `Save as milestone…` action via the row's overflow menu (or hover-revealed action). Clicking the action SHALL open the milestone naming dialog with `fromChangeId` set to that row's change id.

#### Scenario: Per-row action creates a milestone from a historical change
- **WHEN** the user opens the overflow menu on a history row with `id = 42` and clicks `Save as milestone…`
- **AND** submits a valid `name`
- **THEN** the system creates a milestone with `fromChangeId = 42`, anchored to that change's author and `createdAt`, and the new milestone appears in the `Milestones` section

### Requirement: Preview a milestone
Clicking a milestone row SHALL render that milestone's content in the editor area as read-only, identical to the preview-from-history flow, with a banner identifying the milestone by name.

#### Scenario: Click previews the milestone
- **WHEN** the user clicks a milestone row named `v1` in the `Milestones` section
- **THEN** the editor area renders the milestone's content read-only and a banner displays `Viewing milestone "v1"`

#### Scenario: Closing the panel returns to the live document
- **WHEN** the user is previewing a milestone and closes the version history panel
- **THEN** the editor returns to the live current document with full editing capabilities

### Requirement: Restore from a milestone
The version history panel SHALL offer a `Restore from this milestone…` action on each milestone row. The action SHALL prompt for confirmation, then call the restore endpoint and append a new entry to the chronological history list.

#### Scenario: Restore confirmation copy mentions the milestone name
- **WHEN** the user clicks `Restore from this milestone…` on a milestone named `v1`
- **THEN** a confirmation modal opens with copy referring to `v1` (e.g., `Restore document to milestone "v1"?`) and a warning that current content will be replaced

#### Scenario: Confirmed restore writes new history entry
- **WHEN** the user confirms a restore from milestone `v1`
- **THEN** the API call succeeds, the live document content matches the milestone's content, and a new `modified` entry appears at the top of the chronological history list

#### Scenario: Milestone preserved after restore
- **WHEN** a restore from `v1` completes
- **THEN** `v1` remains listed in the `Milestones` section with no changes to its row

### Requirement: Edit a milestone (rename / re-describe)
The version history panel SHALL offer an `Edit milestone…` action on each milestone row. The action SHALL be enabled only when the current user is the milestone's creator OR an admin. The action SHALL open the same naming dialog used for creation, pre-populated with the existing `name` and `description`, and submit a `PATCH` rather than a `POST`.

#### Scenario: Creator can edit
- **WHEN** the milestone's `createdBy` matches the current user
- **THEN** `Edit milestone…` is enabled in the row's overflow menu

#### Scenario: Non-creator sees disabled edit
- **WHEN** the milestone was created by another user and the current user is not an admin
- **THEN** `Edit milestone…` is disabled with a tooltip reading `Only the creator or an admin can edit this milestone`

#### Scenario: Edit dialog pre-populates fields
- **WHEN** the user clicks `Edit milestone…` for a milestone named `v1` with description `first draft`
- **THEN** the dialog opens with the `name` field set to `v1` and the `description` field set to `first draft`

#### Scenario: Submit updates the row in place
- **WHEN** the user changes the `name` to `v1-final`, submits, and the API returns success
- **THEN** the milestone row updates in place (no panel reload), the new `name` displays immediately

#### Scenario: Name conflict surfaces inline
- **WHEN** the user submits a `name` already used by another milestone for the same path
- **THEN** the dialog stays open with an inline error reading `A milestone named "<name>" already exists for this file` and no row is changed

### Requirement: Orphan attribution rendering
When a milestone row's `createdBy` is `NULL` (creator user was deleted), the panel SHALL render the attribution as `(deleted user)` in muted text. All other behavior SHALL be identical to a normal milestone row, with the exception that only admins can edit or delete it.

#### Scenario: Orphan milestone displays muted attribution
- **WHEN** a milestone has `createdBy = NULL` and is rendered in the Milestones section
- **THEN** the row's attribution segment reads `(deleted user)` in the same muted styling used for other secondary metadata

#### Scenario: Non-admin sees disabled edit and delete on orphan
- **WHEN** a non-admin user views an orphaned milestone (`createdBy = NULL`)
- **THEN** both `Edit milestone…` and `Delete milestone…` are disabled with the standard tooltip

### Requirement: Delete a milestone
The version history panel SHALL offer a `Delete milestone…` action on each milestone row. The action SHALL be enabled only when the current user is the milestone's creator OR an admin. The action SHALL prompt for confirmation before calling the delete endpoint.

#### Scenario: Creator can delete
- **WHEN** the milestone's `createdBy` matches the current user
- **THEN** `Delete milestone…` is enabled in the row's overflow menu

#### Scenario: Non-creator sees disabled delete
- **WHEN** the milestone was created by another user and the current user is not an admin
- **THEN** `Delete milestone…` is disabled with a tooltip reading `Only the creator or an admin can delete this milestone`

#### Scenario: Confirmed deletion removes the row
- **WHEN** the user confirms a delete on a milestone they created
- **THEN** the API call succeeds and the milestone row is removed from the `Milestones` section without reloading the panel
