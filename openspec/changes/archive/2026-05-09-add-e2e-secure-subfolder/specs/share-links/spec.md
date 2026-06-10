# Spec delta: share-links (MODIFIED)

## MODIFIED Requirements

### Requirement: Mint rejects E2E paths

`POST /api/share-links` SHALL reject paths where `isE2EEncrypted(path)` returns true with a 400 response and the message "Cannot create a share-link for an end-to-end encrypted note."

#### Scenario: Mint rejected
- **WHEN** Alice POSTs a mint for `_users/alice/_secure/foo.md`
- **THEN** the response is 400

### Requirement: Existing share-links are revoked on move-to-`_secure/`

When a path is moved INTO `_secure/`, every active share-link for that path SHALL be deleted in the same transaction. The UI confirms this consequence before the move.

#### Scenario: Move-to-secure deletes share-links
- **GIVEN** a share-link `/share/abc123` resolves to `_users/alice/foo.md`
- **WHEN** Alice moves `foo.md` into `_secure/`
- **THEN** `/share/abc123` returns 404 on next resolution
