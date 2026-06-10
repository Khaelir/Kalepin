# Spec delta: document-grants (MODIFIED)

## MODIFIED Requirements

### Requirement: Granting on E2E paths remains rejected

`POST /api/grants` SHALL continue to reject E2E paths (carried forward from `add-shared-with-me-grants`). The error message SHALL reference a future `add-e2e-grant-sharing` change for users who need this.

#### Scenario: Grant on E2E path still rejected after stage 2 ships
- **WHEN** Alice POSTs a grant for an E2E path
- **THEN** the response is 400 with a message naming a future change for E2E sharing

### Requirement: Move-to-`_secure/` revokes existing grants atomically

When a path with active grants moves into `_secure/`, all grants SHALL be revoked in the same transaction as the move. The UI confirms the count before invoking.

#### Scenario: Move revokes grants
- **GIVEN** Alice's note has grants for Bob (read) and Carol (write)
- **WHEN** Alice moves the note into `_secure/`
- **THEN** both grants have `revoked_at = now`; Bob and Carol see a 404 on next read
