## 1. Async Comment Embeddings

- [x] 1.1 Make `indexCommentEmbeddings()` fire-and-forget in `comments.service.ts` `addComment()` — keep `indexNoteComments()` synchronous
- [x] 1.2 Apply same async pattern to `replyToThread()` in `comments.service.ts`
- [x] 1.3 Add tests verifying comment is returned before embedding completes and that embedding failures don't propagate

## 2. MCP Usage Log Schema Enhancement

- [x] 2.1 Add `resultCount` (integer, nullable) and `errorMessage` (text, nullable) columns to `McpUsageLog` entity
- [x] 2.2 Update `StatsService.logToolCall()` signature to accept optional `resultCount` and `errorMessage` (truncate to 200 chars)
- [x] 2.3 Update `mcp.service.ts` `wrapTool` to pass `errorMessage` on failure
- [x] 2.4 Update `search_notes` tool wrapper to pass `resultCount` from search results length

## 3. MCP Usage Pruning Hard Cap

- [x] 3.1 Add 5000-row hard cap logic to `StatsService.pruneOldEntries()` — after time-based prune, delete oldest rows if count exceeds 5000
- [x] 3.2 Update pruning tests to cover the hard cap scenario

## 4. MCP Stats Tool — Percentiles and Search Quality

- [x] 4.1 Add P50/P95 computation to `StatsService.getMcpTools()` using SQLite window functions or sorted array percentile
- [x] 4.2 Add `avgResultCount` (for search tools) to the tools view response
- [x] 4.3 Update `mcp_stats` tool view enum to include `"system"` and `"app_stats"`
- [x] 4.4 Update tests for enhanced tools view

## 5. Daily Stats Service

- [x] 5.1 Create `daily_stats` table (CREATE IF NOT EXISTS) in a new `DailyStatsService` with in-memory counters and 5-minute flush interval
- [x] 5.2 Implement counter increment methods: `trackSearch(empty: boolean)`, `trackNoteCreated()`, `trackNoteEdited()`, `trackCommentAdded()`, `trackCommentResolved()`, `trackOtConcurrentEdit()`, `trackActiveUser(userId)`
- [x] 5.3 Implement flush logic: upsert current counters into `daily_stats` row for today, reset in-memory state
- [x] 5.4 Register SIGTERM/SIGINT hooks to flush on shutdown
- [x] 5.5 Implement 90-day pruning on startup
- [x] 5.6 Add tests for counter accumulation, flush, and pruning

## 6. Failed Searches Log

- [x] 6.1 Create `failed_searches` table (CREATE IF NOT EXISTS) in `DailyStatsService` or `SearchService`
- [x] 6.2 Implement `logFailedSearch(query, source)` with 100-row FIFO eviction
- [x] 6.3 Hook into `SearchService.search()` to call `logFailedSearch` when merged results are empty
- [x] 6.4 Hook into MCP `search_notes` tool to pass source='mcp'
- [x] 6.5 Add tests for FIFO eviction at capacity

## 7. System Health View

- [x] 7.1 Create `SystemHealthService` (or method on StatsService) that collects: DB file size (PRAGMA), table row counts, embedding/FTS coverage
- [x] 7.2 Add vault stats collection: note count, attachment count + size, open/resolved comment threads
- [x] 7.3 Add runtime stats: `process.uptime()`, embedding model status from `EmbeddingService`, vector cache status from `SearchService`, active OT sessions from `OTSessionManager`
- [x] 7.4 Wire `system` view in `mcp_stats` tool to call system health collection
- [x] 7.5 Add tests for system health response shape

## 8. App Stats MCP View

- [x] 8.1 Wire `app_stats` view in `mcp_stats` tool to return `daily_stats` rows + `failed_searches` rows
- [x] 8.2 Add tests for app_stats view response

## 9. Event Hooks

- [x] 9.1 Hook `DailyStatsService.trackSearch()` into `SearchService.search()` (both frontend and MCP paths)
- [x] 9.2 Hook `trackNoteCreated/trackNoteEdited` into `FilesService` or relevant file write paths
- [x] 9.3 Hook `trackCommentAdded/trackCommentResolved` into `CommentsService`
- [x] 9.4 Hook `trackOtConcurrentEdit` into `OTSessionManager.applyOperation()` when `clientRev < session.revision`
- [x] 9.5 Hook `trackActiveUser` into auth guard or request middleware
