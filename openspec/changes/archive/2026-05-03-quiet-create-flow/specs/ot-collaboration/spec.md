# Spec delta: ot-collaboration (MODIFIED)

## ADDED Requirements

### Requirement: Watcher events for atomic-write tmp paths are not broadcast

The OT gateway's chokidar handlers (both shared-vault and per-user-personal) SHALL drop events whose path matches the atomic-write tmp pattern (`*.tmp.<hex>`). Neither `file:changed` nor `file:tree-update` events SHALL be emitted for such paths.

#### Scenario: Atomic write produces no client-visible event
- **WHEN** `LocalFSAdapter.writeBytesAtomic('Notes/foo.md', …)` runs (creating `Notes/foo.md.tmp.0d8580583738`, then renaming)
- **THEN** no connected WebSocket client receives a `file:changed` or `file:tree-update` event whose `path` ends in `.tmp.<hex>`
- **AND** the rename-into-place still produces the expected `file:changed` for `Notes/foo.md`

#### Scenario: Direct write of a non-tmp path is unaffected
- **WHEN** `LocalFSAdapter.write('Notes/bar.md', …)` runs (no tmp file)
- **THEN** the watcher emits `file:changed` for `Notes/bar.md` as before

### Requirement: Active-document echo is suppressed when OT recently delivered the revision

When the frontend receives a `file:changed` for the currently-active document and the local OT session has received a revision update within the last 2 seconds, the user-visible toast SHALL be suppressed. The editor content refresh path is unchanged.

#### Scenario: OT save produces no echo toast
- **GIVEN** the active document is `Notes/foo.md`
- **AND** the OT session received revision N at time T
- **WHEN** a `file:changed` event for `Notes/foo.md` arrives at time T + 1s
- **THEN** no toast is shown

#### Scenario: External editor produces an echo toast
- **GIVEN** the active document is `Notes/foo.md`
- **AND** the OT session has not received any revision in the last 10 seconds
- **WHEN** a `file:changed` event for `Notes/foo.md` arrives
- **THEN** the toast `File changed externally: Notes/foo.md` is shown
