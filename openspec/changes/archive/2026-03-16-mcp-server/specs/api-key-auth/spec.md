## ADDED Requirements

### Requirement: API key creation
The system SHALL allow authenticated users to create API keys. Each key SHALL have a name, be associated with the creating user, and be prefixed with `kp_`. The full key SHALL be shown only once at creation time.

#### Scenario: Create an API key
- **WHEN** an authenticated user sends `POST /api/auth/api-keys` with `{ "name": "My MCP client" }`
- **THEN** the system returns `{ "id", "name", "key": "kp_...", "createdAt" }` and stores a SHA-256 hash of the key

#### Scenario: Key displayed only once
- **WHEN** a user lists their API keys via `GET /api/auth/api-keys`
- **THEN** the response includes `{ "id", "name", "createdAt" }` but NOT the key value

### Requirement: API key authentication
The system SHALL accept API keys in the `Authorization: Bearer kp_...` header as an alternative to JWT tokens for all REST API endpoints.

#### Scenario: Valid API key
- **WHEN** a request includes `Authorization: Bearer kp_abc123...`
- **THEN** the system hashes the key, looks up the matching record, and authenticates the request as the associated user

#### Scenario: Invalid API key
- **WHEN** a request includes `Authorization: Bearer kp_invalid`
- **THEN** the system returns 401 Unauthorized

#### Scenario: JWT still works
- **WHEN** a request includes a valid JWT in the Authorization header
- **THEN** the system authenticates via JWT as before (no change to existing behavior)

### Requirement: API key revocation
The system SHALL allow users to revoke their API keys.

#### Scenario: Revoke an API key
- **WHEN** an authenticated user sends `DELETE /api/auth/api-keys/:id`
- **THEN** the key is deleted and any subsequent requests using that key return 401 Unauthorized

#### Scenario: Cannot revoke another user's key
- **WHEN** a user attempts to delete an API key belonging to another user
- **THEN** the system returns 404 Not Found
