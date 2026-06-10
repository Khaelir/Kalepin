## ADDED Requirements

### Requirement: OAuth access token authentication

The system SHALL accept OAuth access tokens (prefixed `kpoa_at_`) in the `Authorization: Bearer ...` header as a third credential shape alongside API keys (`kp_`) and JWTs. The guard SHALL produce the same `request.user` shape (`{ sub, email, scope }`) regardless of token type, so downstream code remains unchanged.

#### Scenario: Valid OAuth access token
- **WHEN** a request includes `Authorization: Bearer kpoa_at_<…>`
- **THEN** the system hashes the token, looks up the matching record, verifies it is unrevoked and unexpired, and authenticates the request as the associated user with `scope` derived from the OAuth grant's scope strings

#### Scenario: Expired OAuth access token
- **WHEN** a request includes an OAuth access token whose `expires_at` is in the past
- **THEN** the system returns 401 with `WWW-Authenticate: Bearer error="invalid_token"`

#### Scenario: Revoked OAuth access token
- **WHEN** a request includes an OAuth access token whose grant has been revoked
- **THEN** the system returns 401 with `WWW-Authenticate: Bearer error="invalid_token"`

#### Scenario: Token type discrimination
- **WHEN** the Authorization header begins with `Bearer kp_`, `Bearer kpoa_`, or any other shape
- **THEN** the guard routes to the API-key, OAuth-token, or JWT verification path respectively without trying the others

### Requirement: MCP session bound to authenticated user

The MCP layer SHALL verify that the request's authenticated user matches the user stored on the session referenced by `Mcp-Session-Id`. On mismatch the system SHALL respond `403 Forbidden` and SHALL NOT touch the session's state, transport, or McpServer instance.

#### Scenario: Session reuse with matching user
- **WHEN** a request to `/mcp` includes `Mcp-Session-Id: <sid>` and an Authorization header that authenticates as the user who originally initialised that session
- **THEN** the request is dispatched to the session's transport as today

#### Scenario: Session ID with a different user
- **WHEN** a request to `/mcp` includes `Mcp-Session-Id: <sid>` (an existing session belonging to user A) and an Authorization header that authenticates as user B
- **THEN** the system returns `403 Forbidden` with body `{ "error": "session_user_mismatch" }` and does not invoke the session's transport

#### Scenario: Session ID with no authentication
- **WHEN** a request to `/mcp` includes `Mcp-Session-Id: <sid>` but no Authorization header
- **THEN** the system returns `401 Unauthorized` (the auth guard rejects before reaching the session lookup; `WWW-Authenticate` set per OAuth requirements)

### Requirement: Credential revocation sweeps in-memory MCP sessions

When an API key, OAuth grant, or OAuth access token is revoked, the system SHALL immediately close any in-memory MCP sessions whose stored `userId` belongs to a credential being revoked AND whose origin credential matches the revoked one. Sessions remain closable via this sweep regardless of whether they would otherwise have been picked up by the next idle TTL pass.

#### Scenario: Revoke API key kills its sessions
- **WHEN** a user revokes an API key and any active MCP session was opened using that key
- **THEN** the matching session is closed; the next request bearing its session ID begins a fresh stateless dispatch (and 401s on the revoked credential)

#### Scenario: Revoke OAuth grant kills its sessions
- **WHEN** a user revokes an OAuth grant that has any active MCP session
- **THEN** the matching session is closed and removed from the in-memory map

### Requirement: OAuth scope strings map to ApiKeyScope

The auth guard SHALL translate OAuth scope strings (`notes.read`, `notes.comment`, `notes.write`) into the existing `ApiKeyScope` values for permission checks. The mapping SHALL match the table: `notes.read` → `ro`; `notes.read notes.comment` → `rc`; `notes.read notes.comment notes.write` → `rw`. OAuth tokens SHALL NEVER resolve to `admin` scope.

#### Scenario: Read+write OAuth token hits a write endpoint
- **WHEN** a request to a write endpoint (requires `rw`) presents an OAuth access token whose grant scope is `notes.read notes.comment notes.write`
- **THEN** the request is allowed

#### Scenario: Read-only OAuth token hits a write endpoint
- **WHEN** a request to a write endpoint presents an OAuth access token whose grant scope is `notes.read`
- **THEN** the request is rejected with 403 and the message indicates insufficient scope

#### Scenario: OAuth token cannot reach admin endpoints
- **WHEN** any OAuth access token (regardless of granted scope) is presented to an endpoint requiring `admin`
- **THEN** the request is rejected with 403 — the guard SHALL NOT translate any combination of OAuth scopes into `admin`

## MODIFIED Requirements

### Requirement: API key authentication
The system SHALL accept API keys in the `Authorization: Bearer kp_...` header as an alternative to JWT tokens for all REST API endpoints. The guard SHALL also accept OAuth access tokens (`Authorization: Bearer kpoa_at_...`); see "OAuth access token authentication".

#### Scenario: Valid API key
- **WHEN** a request includes `Authorization: Bearer kp_abc123...`
- **THEN** the system hashes the key, looks up the matching record, and authenticates the request as the associated user

#### Scenario: Invalid API key
- **WHEN** a request includes `Authorization: Bearer kp_invalid`
- **THEN** the system returns 401 Unauthorized

#### Scenario: JWT still works
- **WHEN** a request includes a valid JWT in the Authorization header
- **THEN** the system authenticates via JWT as before (no change to existing behavior)

#### Scenario: Unknown bearer shape
- **WHEN** a request includes `Authorization: Bearer something-without-kp-or-kpoa-prefix-and-not-a-valid-jwt`
- **THEN** the system returns 401 Unauthorized
