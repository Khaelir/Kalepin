# Spec delta: comments (MODIFIED)

## MODIFIED Requirements

### Requirement: Comments are disabled on E2E paths

Path-keyed comment routes (`POST /api/comments`, `GET /api/comments?path=...`, etc.) SHALL reject requests where the path makes `isE2EEncrypted(path)` true. The error response SHALL be 403 with code `e2e-no-comments`. The frontend comments panel SHALL show a banner explaining the disable.

#### Scenario: Comment creation rejected
- **GIVEN** stub `isE2EEncrypted('_users/alice/_secure/journal.md') === true`
- **WHEN** Alice POSTs a comment for that path
- **THEN** the response is 403 with `{ code: 'e2e-no-comments' }`

#### Scenario: Comments panel banner
- **WHEN** Alice opens an E2E note in the editor
- **THEN** the right-panel comments section shows "Comments are disabled in end-to-end encrypted folders"
