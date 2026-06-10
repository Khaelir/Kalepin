## ADDED Requirements

### Requirement: Log every MCP tool call
The system SHALL record every MCP tool invocation in the `mcp_usage_log` SQLite table with the tool name, user ID, API key ID (if applicable), duration in milliseconds, success/failure status, and error message (if failed).

#### Scenario: Successful tool call
- **WHEN** an MCP client invokes a tool (e.g. `search_notes`, `read_note`)
- **THEN** the system inserts a row with `success = true`, the measured `durationMs`, and `error = NULL`

#### Scenario: Failed tool call
- **WHEN** an MCP tool callback throws an error
- **THEN** the system inserts a row with `success = false` and the error message, then re-throws the error so the MCP client receives the failure

#### Scenario: wrapTool helper
- **WHEN** `McpService.createMcpServer()` registers tools
- **THEN** every tool callback is wrapped via a `wrapTool(name, callback)` helper that handles timing and logging transparently

### Requirement: mcp_usage_log table schema
The `mcp_usage_log` table SHALL have the following columns: `id` (auto-increment primary key), `timestamp` (datetime, indexed, defaults to current time), `toolName` (text, indexed), `userId` (integer, indexed), `apiKeyId` (integer, nullable), `durationMs` (integer), `success` (boolean), `error` (text, nullable).
