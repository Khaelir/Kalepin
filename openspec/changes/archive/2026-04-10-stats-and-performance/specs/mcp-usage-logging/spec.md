## MODIFIED Requirements

### Requirement: mcp_usage_log table schema
The `mcp_usage_log` table SHALL have the following columns: `id` (auto-increment primary key), `timestamp` (datetime, indexed, defaults to current time), `toolName` (text, indexed), `userId` (integer, indexed), `apiKeyId` (integer, nullable), `durationMs` (integer), `success` (boolean), `error` (text, nullable), `resultCount` (integer, nullable), `errorMessage` (text, nullable, max 200 characters).

#### Scenario: Search tool logs result count
- **WHEN** the `search_notes` tool completes successfully with 5 results
- **THEN** the logged row has `resultCount = 5`

#### Scenario: Non-search tool result count
- **WHEN** a non-search tool (e.g., `read_note`) completes
- **THEN** the logged row has `resultCount = NULL`

#### Scenario: Error message truncation
- **WHEN** a tool fails with a 500-character error message
- **THEN** the logged row has `errorMessage` truncated to 200 characters
