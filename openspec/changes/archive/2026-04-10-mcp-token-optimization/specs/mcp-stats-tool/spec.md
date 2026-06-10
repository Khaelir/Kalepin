## ADDED Requirements

### Requirement: MCP stats tool registration
The system SHALL register an `mcp_stats` tool when the API key has `admin` scope. The tool MUST NOT be registered for non-admin keys.

#### Scenario: Admin key session
- **WHEN** an MCP session is initialized with an admin-scoped API key
- **THEN** the `mcp_stats` tool is available alongside other admin tools

#### Scenario: Non-admin key session
- **WHEN** an MCP session is initialized with a non-admin API key
- **THEN** the `mcp_stats` tool is not registered

### Requirement: Stats view parameter
The `mcp_stats` tool SHALL accept a `view` parameter with values `"overview"`, `"tools"`, or `"users"`.

#### Scenario: Overview view
- **WHEN** `mcp_stats` is called with `view: "overview"`
- **THEN** it returns daily aggregates with `date`, `totalCalls`, `errors`, `avgDurationMs` from `StatsService.getOverview()`

#### Scenario: Tools view
- **WHEN** `mcp_stats` is called with `view: "tools"`
- **THEN** it returns per-tool aggregates with `toolName`, `totalCalls`, `avgDurationMs`, `maxDurationMs`, `errors` from `StatsService.getMcpTools()`

#### Scenario: Users view
- **WHEN** `mcp_stats` is called with `view: "users"`
- **THEN** it returns per-user aggregates with `userId`, `email`, `totalCalls`, `lastActive`, `topTools` from `StatsService.getUsers()`

### Requirement: Compact response format
The `mcp_stats` tool SHALL return results as compact JSON (no indentation).
