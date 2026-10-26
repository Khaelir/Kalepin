## Purpose

Exposes a `search_notes` MCP tool returning top-K full-text search hits without URL enrichment.
## Requirements
### Requirement: Remove URL enrichment from MCP search results
The MCP `search_notes` tool SHALL NOT include a `url` field in search results. The REST API search endpoint is unchanged (it never included URLs).

#### Scenario: Search result shape
- **WHEN** `search_notes` is called via MCP
- **THEN** each result contains `path`, `snippet`, `score`, and optional `heading`, `type`, `threadId`, `commentAuthor` — no `url` field

### Requirement: search_notes honours tag filters

The MCP `search_notes` tool SHALL apply the `tag:<name>` filter tokens described by `full-text-search`, and its description SHALL document them (`tag:` filter, nested tags included, AND across tokens, tag-only queries listing notes by recency). Tag-only results SHALL go through the same PIN sentinel handling as other results.

#### Scenario: Agent narrows a search by tag
- **GIVEN** notes A (`#meeting`, "budget") and B (untagged, "budget")
- **WHEN** an MCP client calls `search_notes` with `query: "tag:meeting budget"`
- **THEN** the result contains A and not B, each with its stable `id`

#### Scenario: PIN-locked tagged note
- **GIVEN** a PIN-locked note tagged `meeting`
- **WHEN** an MCP client calls `search_notes` with `query: "tag:meeting"` without an unlock header
- **THEN** that note is returned as `{ path, id, kind: 'pin-protected' }`

