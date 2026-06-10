## 1. Compact JSON and remove by_folder (quick wins)

- [x] 1.1 Replace all `JSON.stringify(data, null, 2)` with `JSON.stringify(data)` in `mcp.service.ts`
- [x] 1.2 Remove `by_folder` key from `ChangeTrackingService.getChangesSince()` response — affects both REST and MCP
- [x] 1.3 Verify frontend doesn't reference `by_folder` (search codebase, update if needed)

## 2. Scope-aware tool registration

- [x] 2.1 Refactor `registerTools()` in `mcp.service.ts` to accept the user's scope and conditionally register tools: read-only tools for `notes:read`, write tools for `notes:write`+, admin tools for `admin`
- [x] 2.2 Keep existing runtime scope check in admin tool handlers as defense-in-depth

## 3. `get_updates` summary mode

- [x] 3.1 Add `include_diffs` boolean parameter (default `false`) to `get_updates` tool schema
- [x] 3.2 When `include_diffs` is false, strip `diffs` arrays from file entries before returning
- [x] 3.3 When `include_diffs` is true, replace diffs for binary/XML files (`.svg`, `.png`, draw.io XML content) with a placeholder string indicating omitted size

## 4. `list_files` flat output

- [x] 4.1 Add a private `flattenPaths(tree: FileEntry[]): string[]` helper in `mcp.service.ts` that recursively collects file paths (skipping directories and `_attachments/`)
- [x] 4.2 Update `list_files` MCP handler to return `\n`-joined flat path list instead of JSON tree
- [x] 4.3 REST API `GET /api/files/tree` remains unchanged

## 5. `read_note` preview mode

- [x] 5.1 Add `maxLength` (optional positive integer) and `include_resolved` (optional boolean, default false) parameters to `read_note` tool schema
- [x] 5.2 Implement `extractHeadings(markdown: string): string[]` — regex `^#{1,6}\s+(.+)` with fenced code block exclusion, returns heading lines with original `#` prefixes
- [x] 5.3 When `maxLength` is set and content exceeds it: return `contentHash`, heading outline (or first `maxLength` chars if no headings), first paragraph, `fullLength`, comment summary (total/open/resolved counts), attachment metadata
- [x] 5.4 When `maxLength` is not set or content fits: return full content (current behavior)
- [x] 5.5 Filter resolved comment threads from MCP response unless `include_resolved: true`

## 6. `read_attachment` cleanup

- [x] 6.1 Build a node ID mapping during draw.io XML parsing: `originalId → n{sequential}`. Apply to both nodes and edge `from`/`to` references
- [x] 6.2 Add HTML entity decoding for labels: `&#39;` → `'`, `&nbsp;` → ` `, `&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`
- [x] 6.3 Strip HTML tags from labels (regex: `/<[^>]+>/g` → `""`, then trim/collapse whitespace)
- [x] 6.4 Filter edges where `from === ""` or `to === ""`

## 7. `search_notes` URL removal

- [x] 7.1 Remove `url` enrichment from MCP `search_notes` handler (delete the `buildNoteUrl` call in the `.map()`)

## 8. `mcp_stats` admin tool

- [x] 8.1 Inject `StatsService` into `McpService`
- [x] 8.2 Register `mcp_stats` tool (admin scope only) with `view` enum param: `"overview"` | `"tools"` | `"users"`
- [x] 8.3 Route each view to the corresponding `StatsService` method, return compact JSON

## 9. Verification

- [x] 9.1 Test `get_updates` default returns no diffs, `include_diffs: true` returns diffs with binary filtering
- [x] 9.2 Test `list_files` returns flat paths via MCP, tree via REST API
- [x] 9.3 Test `read_note` with `maxLength` on: short note (full content), long note with headings (outline), long note without headings (preview)
- [x] 9.4 Test `read_note` resolved comment filtering: default hides resolved, `include_resolved: true` shows all
- [x] 9.5 Test `read_attachment` produces compact IDs, clean labels, no empty edges
- [x] 9.6 Test `mcp_stats` returns correct data for each view, rejected for non-admin keys
- [x] 9.7 Test scope-aware registration: read-only key sees only read tools, admin key sees all tools
- [x] 9.8 Measure before/after response sizes on preprod for key tools to confirm savings
