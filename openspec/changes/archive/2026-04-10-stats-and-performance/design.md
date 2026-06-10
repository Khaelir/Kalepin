## Context

The MCP stats system currently logs every tool call to `mcp_usage_log` with basic fields (tool, user, duration, success, error). An admin-only `mcp_stats` tool exposes three views: overview, tools, users. Pruning deletes rows older than 14 days.

There are no frontend usage analytics. The `add_comment` tool is significantly slower than other write tools (~450ms avg) because it synchronously awaits ONNX embedding before responding. The system has ~10 active frontend users and 2 MCP users.

## Goals / Non-Goals

**Goals:**
- Cut `add_comment` response time to <100ms by making embedding async
- Add search quality and error context signals to MCP usage logs
- Provide app-level usage trends (searches, edits, comments, OT activity) via daily aggregates
- Give admins a system health snapshot (DB size, embedding coverage, OT sessions) via MCP
- Hard-cap all stats tables to prevent unbounded growth

**Non-Goals:**
- Per-request frontend analytics (no tracking individual page views or API calls)
- Real-time dashboards or WebSocket-based stats streaming
- Historical data beyond 90 days
- Frontend UI for stats (admin uses MCP only)

## Decisions

### D1: Fire-and-forget embedding, not background queue

Make `indexCommentEmbeddings()` a fire-and-forget promise (`.catch(log)`) instead of introducing a job queue.

**Why**: A queue (Bull, pg-boss) adds a dependency and operational complexity for a problem that's just "don't await this". The embedding either succeeds in the background (search catches up within seconds) or fails and gets logged. The hybrid search already degrades gracefully to FTS-only when embeddings are missing.

**Alternative considered**: Background job queue — rejected as over-engineered for the volume.

### D2: In-memory counters flushed periodically for daily_stats

Increment counters in a singleton service in memory, flush to SQLite on a 5-minute interval and on shutdown (SIGTERM/SIGINT).

**Why**: Writing a DB row on every search/edit/comment would add latency to hot paths and generate unnecessary write pressure. At 10 users the volume is low, but the pattern should be efficient from the start. Worst case on crash: lose up to 5 minutes of counter increments — acceptable for aggregate stats.

**Alternative considered**: Write-through on every event — rejected for unnecessary I/O on hot paths.

### D3: P50/P95 computed at query time, not stored

Compute percentiles from raw `mcp_usage_log` rows using SQLite window functions when `mcp_stats` is called, rather than pre-aggregating.

**Why**: With a 14-day window capped at 5000 rows, the computation is trivial (single-digit ms). Storing percentiles would require a separate aggregation job and table for minimal benefit.

**Alternative considered**: Pre-computed daily percentile rows — rejected as unnecessary complexity at this scale.

### D4: `system` view on existing `mcp_stats` tool, not a separate tool

Add `system` and `app_stats` as new enum values on the existing `view` parameter rather than creating new tools.

**Why**: Keeps the admin surface area in one place. The tool is already admin-gated. Adding views is backwards-compatible (existing clients that only use overview/tools/users are unaffected).

### D5: failed_searches uses FIFO eviction with hard cap

When inserting a new failed search and the table has 100 rows, delete the oldest row before inserting. This is simpler than time-based pruning and guarantees a constant footprint.

**Why**: Time-based pruning (e.g., 7 days) could result in 0 rows during quiet periods or unbounded rows during active periods. A hard cap ensures constant disk usage regardless of activity patterns.

### D6: OT concurrent edit counter via session manager

Add a counter increment in `OTSessionManager.applyOperation()` when `clientRev < session.revision` (meaning the operation required transform against concurrent edits). Expose via an in-memory counter on the daily stats service.

**Why**: The transform loop already detects this condition. One `if` check and counter increment has zero performance impact. No new tables or event systems needed.

## Risks / Trade-offs

- **[Async embedding race]** If a user adds a comment and immediately searches for it, the embedding may not be ready yet → **Mitigation**: FTS indexing stays synchronous, so the comment will appear in FTS results immediately. Only semantic/vector search may lag by a few seconds.
- **[Counter loss on crash]** In-memory daily_stats counters are lost if the process crashes between flushes → **Mitigation**: 5-minute flush interval limits loss. Stats are aggregate trends, not billing — small gaps are acceptable.
- **[SQLite file size via PRAGMA]** `PRAGMA page_count * page_size` gives the DB file size but may slightly differ from actual disk usage (due to WAL) → **Mitigation**: Good enough for admin health checks, not used for billing.

## Migration Plan

All changes are additive (new columns are nullable, new tables are CREATE IF NOT EXISTS). No data migration needed. Deployment order doesn't matter — the code handles missing columns/tables gracefully via TypeORM synchronize.

Rollback: Drop the new tables and columns. No data loss for existing functionality.
