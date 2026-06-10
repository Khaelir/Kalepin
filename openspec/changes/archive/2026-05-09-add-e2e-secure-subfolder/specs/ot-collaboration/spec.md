# Spec delta: ot-collaboration (MODIFIED)

## MODIFIED Requirements

### Requirement: `doc:open` rejects E2E paths

The OT gateway SHALL reject `doc:open` for paths where `canCollab(path)` returns false (which is the case for `isE2EEncrypted` paths). The reject reason SHALL be `e2e-no-collab`. The frontend Editor SHALL fall back to local-only edit mode and surface a banner explaining the carve-out.

#### Scenario: doc:open rejected for E2E path
- **GIVEN** Alice opens `_users/alice/_secure/foo.md`
- **WHEN** the frontend emits `doc:open`
- **THEN** the gateway responds `doc:open:rejected` with `reason: 'e2e-no-collab'`
- **AND** the editor switches to local-only edit mode

### Requirement: WS broadcasts do not surface E2E content

`broadcastToVisible` SHALL not include any plaintext content from `isE2EEncrypted` paths in WS events. Tree updates MAY surface the path itself (still owned by the user), but no content excerpts.

#### Scenario: Tree update for E2E path contains no content
- **WHEN** Alice creates `_users/alice/_secure/new.md`
- **THEN** the `file:tree-update` event contains the path entry but no content excerpt
