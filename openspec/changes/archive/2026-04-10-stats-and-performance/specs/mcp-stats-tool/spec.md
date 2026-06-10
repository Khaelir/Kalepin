## MODIFIED Requirements

### Requirement: Stats view parameter
The `mcp_stats` tool SHALL accept a `view` parameter with values `"overview"`, `"tools"`, `"users"`, `"system"`, or `"app_stats"`.

#### Scenario: Overview view
- **WHEN** `mcp_stats` is called with `view: "overview"`
- **THEN** it returns daily aggregates with `date`, `totalCalls`, `errors`, `avgDurationMs`

#### Scenario: Tools view with percentiles
- **WHEN** `mcp_stats` is called with `view: "tools"`
- **THEN** it returns per-tool aggregates with `toolName`, `totalCalls`, `avgDurationMs`, `p50Ms`, `p95Ms`, `maxDurationMs`, `errors`, `avgResultCount` (for search tools only, null for others)

#### Scenario: Users view
- **WHEN** `mcp_stats` is called with `view: "users"`
- **THEN** it returns per-user aggregates with `userId`, `email`, `totalCalls`, `lastActive`, `topTools`

#### Scenario: System view
- **WHEN** `mcp_stats` is called with `view: "system"`
- **THEN** it returns system health data as defined in the system-health-view spec (DB stats, vault stats, runtime stats)

#### Scenario: App stats view
- **WHEN** `mcp_stats` is called with `view: "app_stats"`
- **THEN** it returns `{ days: [...daily_stats rows...], failedSearches: [...recent failed searches...] }`
