## Why

There is no visibility into how the MCP server is used — which tools are called, by whom, how often, or whether they fail. This makes it hard to prioritize improvements, detect misuse, or understand adoption patterns. This change adds lightweight, developer-facing usage analytics for MCP tool calls.

## What Changes

- New `mcp_usage_log` SQLite table that records every MCP tool invocation with tool name, user, duration, status, and optional error message
- A `wrapTool()` helper in `McpService` that wraps each `registerTool` callback to capture timing and outcomes, then inserts a row into the log
- A `@Cron` daily job + on-startup cleanup that deletes rows older than 14 days
- New `admin:stats` permission added to the permissions list, included in the `admin` scope
- Three new admin-only endpoints:
  - `GET /api/admin/stats/overview` — daily volume and error rate over the last 14 days
  - `GET /api/admin/stats/mcp-tools` — per-tool breakdown (call count, avg/max latency, error count)
  - `GET /api/admin/stats/users` — per-user breakdown (call count, last active, top tools)
- Documentation added to backend and mcp-server READMEs

## Capabilities

### New Capabilities
- `mcp-usage-logging`: Record every MCP tool call with timing, user, and outcome
- `mcp-usage-pruning`: Automatic 14-day retention via daily cron and startup cleanup
- `mcp-usage-admin-endpoints`: Admin-only REST endpoints for querying usage stats

### Modified Capabilities

(none)

## Impact

- **Backend**: `mcp.service.ts` (wrapTool helper + logging), new `McpUsageLog` TypeORM entity, new `StatsModule` with controller + service, `permissions.ts` (add `admin:stats`)
- **No frontend changes**
- **No new env vars**
- **No breaking changes** — additive only
