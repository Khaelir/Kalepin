## ADDED Requirements

### Requirement: API key scope profiles
The system SHALL support three scope profiles for API keys: `ro` (Read-only), `rc` (Read + Comments), and `rw` (Full access). Each API key SHALL have exactly one scope. The scope SHALL be immutable after creation.

#### Scenario: Read-only key accesses read endpoint
- **WHEN** a request is made with an API key that has scope `ro` to a read endpoint (e.g. `GET /api/files/:path`)
- **THEN** the request succeeds and returns the expected data

#### Scenario: Read-only key attempts write endpoint
- **WHEN** a request is made with an API key that has scope `ro` to a write endpoint (e.g. `POST /api/files`)
- **THEN** the system returns 403 Forbidden

#### Scenario: Read + Comments key adds a comment
- **WHEN** a request is made with an API key that has scope `rc` to `POST /api/comments`
- **THEN** the request succeeds and the comment is created

#### Scenario: Read + Comments key attempts to create a note
- **WHEN** a request is made with an API key that has scope `rc` to `POST /api/files`
- **THEN** the system returns 403 Forbidden

#### Scenario: Full access key can do everything
- **WHEN** a request is made with an API key that has scope `rw` to any endpoint
- **THEN** the request succeeds (same behavior as today)

### Requirement: Permission map
The system SHALL maintain a mapping from each scope profile to a set of permission atoms. The permission atoms SHALL be: `notes:read`, `notes:search`, `notes:create`, `notes:edit`, `notes:delete`, `comments:read`, `comments:write`, `links:read`, `stars:read`, `stars:write`, `updates:read`, `attachments:read`, `attachments:write`, `admin:backup`, `users:read`.

#### Scenario: Read-only permissions
- **WHEN** the scope is `ro`
- **THEN** the allowed permissions are: `notes:read`, `notes:search`, `comments:read`, `links:read`, `stars:read`, `updates:read`, `attachments:read`, `users:read`

#### Scenario: Read + Comments permissions
- **WHEN** the scope is `rc`
- **THEN** the allowed permissions are: all `ro` permissions plus `comments:write`

#### Scenario: Full access permissions
- **WHEN** the scope is `rw`
- **THEN** all permission atoms are allowed

### Requirement: Route-level permission enforcement
Each route protected by `CombinedAuthGuard` SHALL declare which permission it requires. The guard SHALL check the API key's scope against the required permission and return 403 Forbidden if the scope does not include that permission. JWT-authenticated requests SHALL bypass scope checks and have full access.

#### Scenario: API key with insufficient scope
- **WHEN** a request uses an API key whose scope does not include the route's required permission
- **THEN** the system returns 403 Forbidden with a message indicating insufficient scope

#### Scenario: JWT request bypasses scope check
- **WHEN** a request uses a JWT token (not an API key) to access any route
- **THEN** the request is allowed regardless of route permission requirements

### Requirement: Whoami endpoint
The system SHALL expose `GET /api/auth/api-keys/whoami` authenticated by `CombinedAuthGuard`. It SHALL return the current key's scope and the list of permissions it grants. For JWT-authenticated requests, it SHALL return scope `rw` with all permissions.

#### Scenario: API key calls whoami
- **WHEN** a request with an API key of scope `rc` calls `GET /api/auth/api-keys/whoami`
- **THEN** the response is `{ "scope": "rc", "permissions": ["notes:read", "notes:search", "comments:read", "comments:write", "links:read", "stars:read", "updates:read", "attachments:read", "users:read"] }`

#### Scenario: JWT calls whoami
- **WHEN** a request with a JWT token calls `GET /api/auth/api-keys/whoami`
- **THEN** the response is `{ "scope": "rw", "permissions": [...all permissions...] }`

### Requirement: Existing keys default to full access
When the `scope` column is added, existing API keys that have no scope value SHALL be treated as `rw` (Full access) to maintain backwards compatibility.

#### Scenario: Legacy key without scope
- **WHEN** a request uses an API key created before the scope feature existed (scope is NULL in DB)
- **THEN** the system treats it as scope `rw` and grants full access
