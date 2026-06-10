## Why

The `add_comment` MCP tool is 10x slower than every other write tool (~450ms avg, 775ms peak) because it synchronously embeds comment text before responding. Meanwhile, the existing MCP stats lack error context, search quality signals, and latency percentiles. There are no frontend usage analytics at all despite 10+ active users, and admins have no way to check system health (DB size, embedding coverage, OT activity) without SSH.

## What Changes

- **Async comment embeddings**: `indexCommentEmbeddings()` becomes fire-and-forget on `addComment` and `replyToThread`. FTS indexing stays synchronous. Expected to cut add_comment from ~450ms to ~50ms.
- **MCP stats v2**: Add `result_count` and `error_message` columns to `mcp_usage_log`. Compute P50/P95 at query time from raw rows. Hard cap at 5000 rows + 14-day prune.
- **System health view**: New `system` view on `mcp_stats` exposing DB file size, table row counts, embedding/FTS coverage, vault stats (notes, attachments, open/resolved comments), server uptime, embedding model status, vector cache status, active OT sessions.
- **App-level daily stats**: New `daily_stats` table (1 row/day, in-memory counters flushed periodically) tracking active_users, searches, empty searches, notes created/edited, comments added/resolved, OT concurrent edits. Prune at 90 days.
- **Failed searches log**: New `failed_searches` table logging queries that returned 0 results. Hard capped at 100 rows, oldest pruned first.
- **MCP app_stats view**: Expose daily_stats and failed_searches via the `mcp_stats` tool.

### Storage guardrails (non-negotiable)
- `mcp_usage_log`: 14-day prune + 5000 row hard cap
- `daily_stats`: 90-day prune (~90 rows steady state)
- `failed_searches`: 100 row hard cap
- Total steady-state: ~2000 rows across all stats tables

## Capabilities

### New Capabilities
- `async-comment-embeddings`: Fire-and-forget embedding indexing for comments to unblock MCP responses
- `daily-stats`: App-level daily aggregate counters for frontend usage tracking
- `failed-searches-log`: Capped log of search queries returning 0 results
- `system-health-view`: Admin MCP view for DB size, coverage, vault stats, and system status

### Modified Capabilities
- `mcp-usage-logging`: Add result_count and error_message columns to existing usage log
- `mcp-stats-tool`: Add system, app_stats views; add P50/P95 latency to tools view
- `mcp-usage-pruning`: Add 5000 row hard cap in addition to existing 14-day time-based prune

## Impact

- **Backend services**: `comments.service.ts` (async embedding), `search.service.ts` (result count passthrough, failed search logging), `stats.service.ts` (new queries, daily stats flush), `mcp.service.ts` (new views, result_count logging)
- **Database**: 3 schema changes (alter mcp_usage_log, new daily_stats table, new failed_searches table)
- **OT layer**: Minor — add concurrent edit counter in `ot-session-manager.ts`
- **No frontend changes** — all stats are backend + MCP-facing
- **No breaking changes** — new columns are nullable, new tables are additive
