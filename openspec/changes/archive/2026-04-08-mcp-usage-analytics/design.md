## Context

MCP tool calls are handled inside `McpService.createMcpServer()` via the MCP SDK's `registerTool` callbacks. These bypass NestJS's interceptor/middleware lifecycle — the framework only sees the outer `POST /mcp` request, not individual tool invocations. This means instrumentation must happen inside the tool callbacks themselves.

The project already uses `@nestjs/schedule` (in `BackupModule`) and TypeORM with SQLite. Auth is handled via `CombinedAuthGuard` with scope-based permissions; an `admin` scope already exists.

## Goals / Non-Goals

**Goals:**
- Developer can see MCP tool usage patterns via admin API endpoints
- Every MCP tool call is logged with tool name, user, duration, and outcome
- Stale data is automatically pruned (14-day retention)
- Stats endpoints are admin-only

**Non-Goals:**
- REST API endpoint logging (future scope)
- User-facing dashboards or frontend UI
- Real-time alerting or rate limiting
- Session-level pattern analysis (tool call sequences)

## Decisions

### 1. Wrap individual registerTool callbacks

**Decision**: Create a `wrapTool(name, callback)` helper in `McpService` that wraps each tool's callback to measure duration, catch errors, and log to the database. Apply it to every `registerTool` call.

**Why**: MCP tool calls are invisible to NestJS interceptors. Wrapping at the callback level gives exact tool name, per-tool error handling, and clean duration measurement. The alternative — intercepting at the `transport.handleRequest` level — would require parsing JSON-RPC bodies and couldn't distinguish tool calls from other MCP messages (like `initialize`).

### 2. SQLite table for storage

**Decision**: New `mcp_usage_log` TypeORM entity stored in the existing SQLite database.

**Why**: Fits the existing stack (no new dependencies). SQL makes ad-hoc queries easy. At the expected scale (hundreds to low thousands of tool calls per day), SQLite handles the write load without contention issues. 14-day pruning keeps the table small.

**Alternatives considered**:
- *JSONL log file*: Lower write overhead but harder to query, no indexing.
- *In-memory counters with periodic flush*: Lowest overhead but loses individual request detail.

### 3. Cron + startup pruning

**Decision**: Use `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` to delete rows older than 14 days. Also run the same cleanup on module init (`onModuleInit`).

**Why**: Daily cron keeps the table bounded. Startup cleanup covers cases where the cron didn't fire (server was down overnight, restarted after a long period). Both are idempotent DELETEs — safe to run multiple times.

### 4. New `admin:stats` permission

**Decision**: Add `admin:stats` to the permissions array. Include it in the `admin` scope. Stats endpoints use `@RequiredScope('admin:stats')`.

**Why**: More granular than reusing `admin:backup`. Allows future API keys that can read stats but not trigger backups. Since the `admin` scope already includes all permissions, existing admin keys get `admin:stats` automatically.

### 5. Inject usage logging service into McpService

**Decision**: Create a `McpUsageService` (or inline in a `StatsService`) that exposes `logToolCall(...)` and the query methods. Inject it into `McpService` as `@Optional()` to avoid circular dependencies.

**Why**: Keeps logging logic separate from MCP tool registration. The `@Optional()` pattern is already used for `BackupService` in `McpService`.

## Table Schema

```sql
CREATE TABLE mcp_usage_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  toolName    TEXT NOT NULL,
  userId      INTEGER NOT NULL,
  apiKeyId    INTEGER,
  durationMs  INTEGER NOT NULL,
  success     BOOLEAN NOT NULL DEFAULT 1,
  error       TEXT
);

CREATE INDEX idx_mcp_usage_timestamp ON mcp_usage_log(timestamp);
CREATE INDEX idx_mcp_usage_user ON mcp_usage_log(userId);
CREATE INDEX idx_mcp_usage_tool ON mcp_usage_log(toolName);
```

## Endpoint Responses

### GET /api/admin/stats/overview
```json
{
  "days": [
    { "date": "2026-04-08", "totalCalls": 142, "errors": 3, "avgDurationMs": 45 },
    { "date": "2026-04-07", "totalCalls": 98, "errors": 1, "avgDurationMs": 52 }
  ]
}
```

### GET /api/admin/stats/mcp-tools
```json
{
  "tools": [
    { "toolName": "search_notes", "totalCalls": 512, "avgDurationMs": 120, "maxDurationMs": 890, "errors": 2 },
    { "toolName": "read_note", "totalCalls": 340, "avgDurationMs": 15, "maxDurationMs": 95, "errors": 0 }
  ]
}
```

### GET /api/admin/stats/users
```json
{
  "users": [
    { "userId": 1, "email": "alice@example.com", "totalCalls": 420, "lastActive": "2026-04-08T14:30:00Z", "topTools": ["search_notes", "read_note"] },
    { "userId": 2, "email": "bob@example.com", "totalCalls": 85, "lastActive": "2026-04-07T09:15:00Z", "topTools": ["edit_note", "create_note"] }
  ]
}
```

## Risks / Trade-offs

**SQLite write per tool call** -- Every MCP tool invocation triggers an INSERT. At low-to-moderate scale this is fine. If it ever becomes an issue, batching writes or switching to in-memory counters is straightforward.

**No REST API coverage** -- This change only instruments MCP tool calls. REST API logging can be added later via a NestJS interceptor without touching this code.

**apiKeyId tracking requires threading through the key ID** -- The current auth guard resolves the API key but may not attach the key's database ID to `request.user`. May need a small adjustment to include `apiKeyId` in the user payload.
