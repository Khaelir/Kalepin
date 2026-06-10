## 1. Permission & entity foundation

- [x] 1.1 Add `admin:stats` to the `PERMISSIONS` array in `permissions.ts` (the `admin` scope already includes all permissions, so no change needed to `SCOPE_PERMISSIONS`)
- [x] 1.2 Create `McpUsageLog` TypeORM entity with columns: `id`, `timestamp`, `toolName`, `userId`, `apiKeyId`, `durationMs`, `success`, `error` — with indexes on `timestamp`, `userId`, `toolName`
- [x] 1.3 Register the entity in `AppModule`'s TypeORM config

## 2. Usage logging in McpService

- [x] 2.1 Create `StatsService` with `logToolCall(toolName, userId, apiKeyId, durationMs, success, error?)` method that inserts into `mcp_usage_log`
- [x] 2.2 Add `wrapTool(name, callback, user)` helper in `McpService` that measures duration, catches errors, calls `StatsService.logToolCall()`, and re-throws on failure
- [x] 2.3 Apply `wrapTool` to every `registerTool` callback in `createMcpServer()`
- [x] 2.4 Thread `apiKeyId` through the MCP user payload (adjust `CombinedAuthGuard` to include key ID when authenticating via API key)

## 3. Pruning

- [x] 3.1 Add pruning method to `StatsService`: `DELETE FROM mcp_usage_log WHERE timestamp < date('now', '-14 days')`
- [x] 3.2 Register `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` on the pruning method
- [x] 3.3 Call pruning on `onModuleInit()` in `StatsModule` or `StatsService`
- [x] 3.4 Ensure `ScheduleModule.forRoot()` is imported (moved to `AppModule` from `BackupModule`)

## 4. Admin stats endpoints

- [x] 4.1 Create `StatsController` at `api/admin/stats` with `CombinedAuthGuard` and `@RequiredScope('admin:stats')`
- [x] 4.2 Implement `GET /api/admin/stats/overview` — daily aggregates (date, totalCalls, errors, avgDurationMs) ordered by date descending
- [x] 4.3 Implement `GET /api/admin/stats/mcp-tools` — per-tool aggregates (toolName, totalCalls, avgDurationMs, maxDurationMs, errors) ordered by totalCalls descending
- [x] 4.4 Implement `GET /api/admin/stats/users` — per-user aggregates (userId, email, totalCalls, lastActive, topTools) ordered by totalCalls descending; join with `users` table for email
- [x] 4.5 Create `StatsModule` importing TypeORM entity, `AuthModule`, `ScheduleModule`; register in `AppModule`

## 5. Documentation

- [x] 5.1 Add "Usage Stats" section to mcp-server README documenting the admin endpoints, their responses, and required permissions
- [x] 5.2 Create a backend README if one doesn't exist, or add the stats endpoints documentation to the appropriate location

## 6. Testing

- [x] 6.1 Unit test `StatsService` — logToolCall inserts correctly, pruning deletes old rows, query methods return expected shapes
- [x] 6.2 Integration test — stats endpoints return 403 for non-admin keys, return correct aggregates for admin keys
