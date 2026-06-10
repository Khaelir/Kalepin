## Purpose

Admin-only HTTP endpoints that expose per-user and per-tool MCP usage statistics.

## Requirements

### Requirement: admin:stats permission
The system SHALL add `admin:stats` to the permissions list. The `admin` scope SHALL include `admin:stats`. All stats endpoints SHALL require the `admin:stats` permission via `@RequiredScope('admin:stats')`.

#### Scenario: Admin-scoped key accesses stats
- **WHEN** a request with an `admin`-scoped API key hits a stats endpoint
- **THEN** access is granted (since `admin` includes `admin:stats`)

#### Scenario: Non-admin key denied
- **WHEN** a request with an `rw`-scoped API key hits a stats endpoint
- **THEN** the server responds with 403 Forbidden

### Requirement: GET /api/admin/stats/overview
The system SHALL expose `GET /api/admin/stats/overview` that returns daily aggregates over the retention period.

#### Scenario: Stats with data
- **WHEN** an admin requests `GET /api/admin/stats/overview`
- **THEN** the server responds with a JSON object containing a `days` array, each entry having `date` (ISO date string), `totalCalls` (integer), `errors` (integer), and `avgDurationMs` (integer), ordered by date descending

#### Scenario: No data
- **WHEN** an admin requests `GET /api/admin/stats/overview` and the log table is empty
- **THEN** the server responds with `{ "days": [] }`

### Requirement: GET /api/admin/stats/mcp-tools
The system SHALL expose `GET /api/admin/stats/mcp-tools` that returns per-tool aggregates over the retention period.

#### Scenario: Stats with data
- **WHEN** an admin requests `GET /api/admin/stats/mcp-tools`
- **THEN** the server responds with a JSON object containing a `tools` array, each entry having `toolName` (string), `totalCalls` (integer), `avgDurationMs` (integer), `maxDurationMs` (integer), and `errors` (integer), ordered by `totalCalls` descending

### Requirement: GET /api/admin/stats/users
The system SHALL expose `GET /api/admin/stats/users` that returns per-user aggregates over the retention period.

#### Scenario: Stats with data
- **WHEN** an admin requests `GET /api/admin/stats/users`
- **THEN** the server responds with a JSON object containing a `users` array, each entry having `userId` (integer), `email` (string), `totalCalls` (integer), `lastActive` (ISO datetime string), and `topTools` (array of up to 3 tool name strings ordered by frequency), ordered by `totalCalls` descending

### Requirement: Documentation
The stats endpoints SHALL be documented in the backend section of the project README.
