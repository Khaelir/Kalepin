## Why

MCP tool responses are significantly larger than necessary, wasting tokens on every LLM interaction. Measured on preprod (35 notes):

- `get_updates` (10 days): **2.3M chars (~584k tokens)** — caused by 100% data duplication (`by_folder` = `other`) and unbounded per-revision diffs
- `list_files`: nested tree JSON with redundant `name`/`type` fields when paths already encode hierarchy
- `read_attachment`: raw draw.io UUIDs (~30 chars each), unclean HTML labels, empty edges
- `search_notes`: includes reconstructible URLs on every result
- All responses: pretty-printed JSON (`null, 2`) adds ~30-40% whitespace

Additionally, admin-only tools (backup) and write tools are registered for all sessions regardless of API key scope, adding fixed schema overhead per turn. There's also no MCP tool for querying usage stats — admins must use the REST API.

## What Changes

- **`get_updates`**: Remove `by_folder` duplication, default to summary mode (stats + file list), diffs opt-in via `include_diffs` param, filter binary/XML diffs
- **`list_files`**: Return flat newline-separated path list for MCP (keep tree for REST API)
- **`read_note`**: Add `maxLength` param — short notes return full content, long notes return extracted heading outline + first paragraph + metadata. Hide resolved comments by default.
- **`read_attachment`**: Compact sequential node IDs, strip HTML entities from labels, filter empty/broken edges
- **`search_notes`**: Drop `url` enrichment (reconstructible from path)
- **All MCP responses**: Switch to compact JSON (`JSON.stringify(data)`)
- **Tool registration**: Scope-aware — hide write tools for read-only keys, hide admin tools for non-admin keys
- **New `mcp_stats` admin tool**: Expose existing `StatsService` queries (overview, tools, users) via MCP

## Capabilities

### New Capabilities
- `mcp-stats-tool`: Admin-only MCP tool to query usage analytics (overview, per-tool, per-user stats)
- `mcp-read-note-preview`: `maxLength` parameter on `read_note` returns heading outline + metadata instead of full content for long notes

### Modified Capabilities
- `mcp-get-updates`: Summary-by-default mode with opt-in diffs, `by_folder` removed
- `mcp-list-files`: Flat path output for MCP, tree preserved for REST API
- `mcp-read-attachment`: Compact IDs, cleaned labels, filtered edges
- `mcp-search-notes`: URL field removed from results
- `mcp-tool-registration`: Scope-aware registration based on API key permissions
- `mcp-response-format`: Compact JSON serialization across all tools

## Impact

- **Backend**: `mcp.service.ts` (all tool handlers), `change-tracking.service.ts` (response shape), `stats.service.ts` (new MCP consumer)
- **Frontend**: None — REST API responses unchanged
- **Breaking changes**: `by_folder` removed from `get_updates` response. MCP clients relying on pretty-printed JSON or `url` field in search results will see different output. REST API is unaffected.
- **Estimated savings**: `get_updates` -98%, `list_files` -65%, `read_attachment` -45%, `search_notes` -33%, all tools -30% from compact JSON
