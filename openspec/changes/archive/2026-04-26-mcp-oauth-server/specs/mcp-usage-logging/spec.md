## MODIFIED Requirements

### Requirement: mcp_usage_log table schema
The `mcp_usage_log` table SHALL have the following columns: `id` (auto-increment primary key), `timestamp` (datetime, indexed, defaults to current time), `toolName` (text, indexed), `userId` (integer, indexed), `apiKeyId` (integer, nullable), `grantId` (integer, nullable), `durationMs` (integer), `success` (boolean), `error` (text, nullable), `resultCount` (integer, nullable), `errorMessage` (text, nullable, max 200 characters). Either `apiKeyId` or `grantId` (or neither, for JWT) SHALL be populated per row but NOT both.

#### Scenario: Search tool logs result count
- **WHEN** the `search_notes` tool completes successfully with 5 results
- **THEN** the logged row has `resultCount = 5`

#### Scenario: Non-search tool result count
- **WHEN** a non-search tool (e.g., `read_note`) completes
- **THEN** the logged row has `resultCount = NULL`

#### Scenario: Error message truncation
- **WHEN** a tool fails with a 500-character error message
- **THEN** the logged row has `errorMessage` truncated to 200 characters

#### Scenario: API key authenticated tool call
- **WHEN** a tool is invoked through a request authenticated by API key `K`
- **THEN** the row has `apiKeyId = K.id` and `grantId = NULL`

#### Scenario: OAuth authenticated tool call
- **WHEN** a tool is invoked through a request authenticated by OAuth grant `G`
- **THEN** the row has `grantId = G.id` and `apiKeyId = NULL`

## ADDED Requirements

### Requirement: OAuth authentication event logging

The system SHALL record dedicated event rows for OAuth lifecycle events. These events SHALL be queryable via the same observability surface as tool calls.

#### Scenario: Refresh success
- **WHEN** a `/oauth/token` refresh completes successfully
- **THEN** an event row is recorded with type `oauth.refresh`, fields `{ grantId, success: true, durationMs }`

#### Scenario: Refresh leeway re-emit
- **WHEN** a `/oauth/token` refresh re-emits the previous rotation under the leeway window
- **THEN** an event row is recorded with type `oauth.refresh.leeway`, fields `{ grantId, success: true }`

#### Scenario: Replay detected
- **WHEN** a consumed refresh token is presented outside the leeway window
- **THEN** an event row is recorded with type `oauth.refresh.replay_detected`, fields `{ grantId, success: false }`; this event SHALL be flagged for high-visibility alerting

#### Scenario: Grant revocation
- **WHEN** any grant is revoked (by user, replay detection, idle expiry, or admin sweep)
- **THEN** an event row is recorded with type `oauth.grant.revoked`, fields `{ grantId, reason: 'user'|'replay'|'expired'|'sweep' }`
