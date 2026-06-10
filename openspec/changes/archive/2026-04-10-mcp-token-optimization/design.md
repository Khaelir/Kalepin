## Context

The MCP layer and REST API share the same service layer (`FilesService`, `SearchService`, `CommentsService`, `ChangeTrackingService`, `StatsService`). The REST API returns typed JSON objects consumed by the frontend. The MCP layer wraps the same data in `JSON.stringify(data, null, 2)` text content, sometimes enriching with URLs or inline comments.

Currently, MCP responses are optimized for human readability (pretty JSON, full data) rather than LLM efficiency (compact, minimal). The REST API is already leaner in most cases.

Existing stats infrastructure: `StatsService` provides `getOverview()`, `getMcpTools()`, `getUsers()` — all behind `admin:stats` scope on the REST controller. The `McpUsageLog` entity tracks `toolName`, `userId`, `apiKeyId`, `durationMs`, `success`, `error` with a 14-day retention.

## Goals / Non-Goals

**Goals:**
- Minimize token consumption for MCP tool responses without losing information the LLM actually needs
- Keep REST API responses unchanged (human-friendly, frontend-compatible)
- Allow LLMs to progressively drill down (summary → detail) instead of getting everything upfront
- Expose usage stats via MCP for admin monitoring
- Register only relevant tools per API key scope

**Non-Goals:**
- Changing the REST API response format
- Adding server-side token counting (optimize by shape, not by measuring)
- Modifying the `StatsService` queries themselves — the MCP tool just wraps existing methods
- Modifying `resolveNotePath` fuzzy matching behavior (separate concern)

## Decisions

### 1. Dual response strategy: REST stays, MCP diverges

**Decision**: The MCP layer formats its own responses independently of the REST API. Both call the same service methods, but shape output differently.

**Why**: The REST API serves a browser frontend that needs typed JSON, nested trees, and sometimes binary data. The LLM needs compact text with minimal redundancy. Trying to serve both from a single format leads to the current bloat.

### 2. `get_updates` summary-by-default

**Decision**: `get_updates` returns a compact summary by default: `period`, `stats`, and a flat file list with `path`, `action`, `changes` count, and `lastChangedAt`. Full unified diffs are available via `include_diffs: true`. The `by_folder` key is removed entirely (from both REST and MCP — it's always `starred` + `other`).

**Alternatives considered**:
- Keep full diffs but cap at N — still expensive for active vaults, and the LLM rarely needs all diffs
- Return only latest diff per file — loses intermediate context but much cheaper. Could be a future `diff_mode: "latest"` option.

**Why summary-by-default**: The common LLM pattern is "what changed?" → scan file list → drill into specific files. The summary enables this two-step pattern. A single `get_updates` + targeted `read_note` calls is cheaper than one massive `get_updates` with all diffs.

### 3. `list_files` flat path list for MCP

**Decision**: MCP `list_files` returns `\n`-separated full paths (files only, no directories). REST API keeps the nested `FileEntry[]` tree.

**Why**: The nested tree encodes hierarchy that paths already express. For 35 files, the tree JSON is ~5,600 chars; the flat list would be ~1,800 chars. The LLM reconstructs hierarchy from path separators. The frontend needs the tree for its sidebar component.

### 4. `read_note` with `maxLength` and server-side heading extraction

**Decision**: Add optional `maxLength` parameter (in characters). When content exceeds `maxLength`, return an outline instead of full content:
- Extract headings by scanning markdown lines for `^#{1,6}\s+` patterns (no dependency on the TOC widget `<div data-type="toc">`)
- Return: `contentHash`, heading outline (indented by level), first paragraph preview, `fullLength`, comment summary (count + open/resolved), attachment metadata
- When content is under `maxLength` (or `maxLength` not provided): return full content (current behavior)
- For long notes without headings: return first `maxLength` characters as preview + metadata

**Why not `headings_only: true`**: A boolean doesn't handle the common case of short notes that don't need truncation. `maxLength` lets the LLM say "give me the full thing if it's short, otherwise just the outline" in a single call. No wasted round-trips for small notes.

### 5. Resolved comments hidden by default in MCP

**Decision**: `read_note` MCP response omits resolved comment threads by default. Add `include_resolved: true` to include them. `list_comments` continues to return all threads (it's an explicit "show me comments" request).

**Why**: Resolved threads are historical context. On the SSO doc, 4 of 7 threads were resolved — that's >50% of the comment section being noise for most LLM tasks. When the LLM needs history, it can opt in.

### 6. `read_attachment` compact IDs and label cleanup

**Decision**: Replace draw.io UUIDs with sequential compact IDs (`n1`, `n2`, ... for nodes). Build a mapping during parsing. Strip HTML entities (`&#39;` → `'`, `&nbsp;` → ` `, `&amp;` → `&`). Remove `<span>`, `<font>`, and other HTML tags from labels. Filter edges where `from` or `to` is empty.

**Why**: Node IDs are used only for edge references within the same response — their actual value is meaningless. Compact IDs save ~6,600 chars on the SSO diagram alone. HTML artifacts in labels are rendering noise that confuses LLMs.

### 7. Compact JSON for all MCP responses

**Decision**: Replace `JSON.stringify(data, null, 2)` with `JSON.stringify(data)` in all MCP tool handlers that return structured data.

**Why**: LLMs don't need indentation. Pretty-printing adds ~30-40% to response size. The REST API uses NestJS serialization which handles formatting independently.

### 8. Scope-aware tool registration

**Decision**: During MCP session initialization, check the API key scope and only register tools the key can use:
- `notes:read` scope: read-only tools only (`search_notes`, `read_note`, `read_attachment`, `list_files`, `list_comments`, `get_updates`)
- `notes:write` scope (or broader): add write tools (`create_note`, `patch_note`, `append_to_note`, `edit_note`, `delete_note`, `add_comment`, `resolve_comment`)
- `admin` scope: add admin tools (`list_backups`, `create_backup`, `restore_backup`, `mcp_stats`)

**Why**: Every registered tool adds schema tokens to every conversation turn. A read-only consumer doesn't need 5 write tool schemas polluting context. Currently all 13+ tools are registered for every session.

### 9. New `mcp_stats` admin tool

**Decision**: Register a single `mcp_stats` tool (admin scope only) with a `view` parameter: `"overview"`, `"tools"`, or `"users"`. Calls the corresponding `StatsService` method. Returns compact JSON.

**Alternatives considered**:
- Three separate tools (`mcp_stats_overview`, `mcp_stats_tools`, `mcp_stats_users`) — adds 3 schemas to tool listing overhead. A single tool with a discriminator is cheaper.
- Return all three views at once — wastes tokens when the LLM only needs one.

**Why single tool**: Minimizes schema overhead (one tool registration) while giving full access to all existing stats queries. The `view` param lets the LLM fetch only what it needs.

## Risks / Trade-offs

**[`by_folder` removal is a breaking change]** → Any MCP client or REST consumer reading `by_folder` will break. Low risk — the frontend likely uses `starred` + `other` directly, and `by_folder` is always derivable. Should verify no frontend code references it.

**[`maxLength` heading extraction is regex-based]** → Won't handle edge cases like headings inside code blocks (`` ```\n# not a heading\n``` ``). Acceptable — false positives are rare and the outline is a preview, not a contract. Could refine later with a markdown parser if needed.

**[Compact JSON harder to debug]** → When inspecting MCP traffic manually, compact JSON is less readable. Acceptable — use `jq` or browser dev tools. The cost savings justify it.

**[Scope-aware registration changes tool availability mid-session]** → Not mid-session — tools are registered at session init. If a key's scope changes, the user must reconnect. This matches existing behavior for admin tools.
