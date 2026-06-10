# Spec delta: share-links (MODIFIED)

## ADDED Requirements

### Requirement: Share-links are minted only on explicit user action

The system SHALL NOT automatically mint a share-link when a user opens a document. A share-link row SHALL be created only in response to an explicit `POST /api/share-links` request initiated by user action (e.g., clicking "Generate public link" in `ShareDialog`).

#### Scenario: Opening a file does not insert a row
- **GIVEN** a path with no row in `short_links`
- **WHEN** the owner opens the file via the standard file-open flow
- **THEN** no row is inserted into `short_links`

#### Scenario: Explicit mint inserts a row
- **WHEN** the owner POSTs to `/api/share-links` with the path
- **THEN** a row is inserted with `created_by_email` set to the owner's canonical email

### Requirement: Share-links carry an optional expiry

`short_links` SHALL include `expires_at` (nullable; null = never). The default expiry on mint SHALL be 30 days for paths under `_users/` and null for shared-vault paths, both overridable per mint.

#### Scenario: Default expiry for a personal note
- **WHEN** the owner mints a share-link for `_users/alice@x.com/foo.md` without specifying `ttl_ms`
- **THEN** `expires_at` is `now + 30 days`

#### Scenario: Default expiry for a shared-vault note
- **WHEN** the owner mints a share-link for `Notes/foo.md` without specifying `ttl_ms`
- **THEN** `expires_at` is null

#### Scenario: Explicit ttl wins
- **WHEN** the owner mints with `ttl_ms = 7 * 86400 * 1000`
- **THEN** `expires_at` is `now + 7 days` regardless of the default

### Requirement: Resolving an expired or revoked share-link returns 410

When a code's `revoked_at` is set or `expires_at < now`, both the public viewer (`GET /share/:code`) and the authenticated resolver (`GET /api/share-links/resolve/:code`) SHALL return HTTP 410 Gone with a message indicating the link is no longer active.

#### Scenario: Expired link
- **GIVEN** a row with `expires_at = now - 1`
- **WHEN** any client resolves the code
- **THEN** the response is 410

#### Scenario: Revoked link
- **GIVEN** a row with `revoked_at = now`
- **WHEN** any client resolves the code
- **THEN** the response is 410

#### Scenario: Unknown code
- **GIVEN** no row matching the code
- **WHEN** a client resolves
- **THEN** the response is 404 (existing behaviour preserved)

### Requirement: Owner and admin can revoke a share-link

`DELETE /api/share-links/:code` SHALL set `revoked_at = now` on the row. Authorization SHALL allow the owner of the underlying path and admins; others receive 403.

#### Scenario: Owner revokes
- **GIVEN** Alice owns the path and has minted a code
- **WHEN** Alice DELETEs `/api/share-links/<code>`
- **THEN** `revoked_at` is set and subsequent resolves return 410

#### Scenario: Non-owner cannot revoke
- **GIVEN** Bob does not own the path
- **WHEN** Bob DELETEs the code
- **THEN** the response is 403

### Requirement: Owner can list the share-link for a path

`GET /api/share-links/by-path?path=...` SHALL return the metadata for the active share-link on the given path (`{ code, expires_at, revoked_at, created_at, last_resolved_at }`) or null if none exists. Authorization SHALL allow the owner and admins.

#### Scenario: Owner reads metadata
- **GIVEN** Alice owns the path and an active share-link exists
- **WHEN** Alice GETs `/api/share-links/by-path?path=Notes/foo.md`
- **THEN** the response is 200 with the metadata blob

#### Scenario: No link exists
- **WHEN** the path has no row
- **THEN** the response is 200 with `null`

## MODIFIED Requirements

### Requirement: Share link code generation

The system SHALL assign a unique 10-character base62 code to a document **on explicit mint** (not on first open), stored in the `short_links` table with `expires_at`, `created_by_email`, and `revoked_at = null`. If an active code already exists for that path, the system SHALL return the existing code; if the existing row is expired or revoked, a new code SHALL be minted.

#### Scenario: First explicit mint
- **WHEN** an owner POSTs `/api/share-links` for a path with no active row
- **THEN** the system generates a new code, stores it with the metadata, and returns the code

#### Scenario: Mint over an active row
- **WHEN** an owner POSTs `/api/share-links` for a path that already has an active row
- **THEN** the system returns the existing code (idempotent)

#### Scenario: Mint over an expired row
- **WHEN** an owner POSTs `/api/share-links` for a path whose existing row is expired
- **THEN** the system mints a new code; the old row remains in the table with `expires_at` unchanged
