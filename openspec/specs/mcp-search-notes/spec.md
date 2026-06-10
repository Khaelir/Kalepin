## Purpose

Exposes a `search_notes` MCP tool returning top-K full-text search hits without URL enrichment.

## Requirements

### Requirement: Remove URL enrichment from MCP search results
The MCP `search_notes` tool SHALL NOT include a `url` field in search results. The REST API search endpoint is unchanged (it never included URLs).

#### Scenario: Search result shape
- **WHEN** `search_notes` is called via MCP
- **THEN** each result contains `path`, `snippet`, `score`, and optional `heading`, `type`, `threadId`, `commentAuthor` — no `url` field
