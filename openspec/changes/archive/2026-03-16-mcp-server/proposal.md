## Why

Kalepin stores valuable structured knowledge as markdown notes, but this content is locked inside the app — inaccessible to LLMs and AI-powered workflows. Users who want an AI assistant to reference, search, or help write their notes must resort to manual copy-paste. Adding an MCP (Model Context Protocol) server makes Kalepin natively AI-accessible, turning it into a queryable knowledge base that integrates with Claude Desktop, Cursor, and any MCP-compatible client.

## What Changes

- **Full-text search engine**: SQLite FTS5-based search across all markdown notes, with BM25 ranking and snippet extraction. Exposed as a new REST endpoint and used by the MCP server.
- **MCP server package**: A new `packages/mcp-server` package implementing the Model Context Protocol, exposing Kalepin notes as resources and providing tools for searching, reading, creating, editing, and deleting notes, as well as managing comments.
- **API key authentication**: A new auth mechanism alongside magic links, allowing MCP clients to authenticate with long-lived API keys scoped per user.
- **MCP prompts**: Pre-built prompt templates (summarize-notes, review-doc) for common AI-assisted workflows.

## Capabilities

### New Capabilities
- `full-text-search`: FTS5-powered search across note content with ranked results and snippet extraction
- `mcp-server`: MCP protocol implementation exposing notes as resources and tools for CRUD operations, search, and comments
- `api-key-auth`: API key generation and authentication for programmatic/MCP access

### Modified Capabilities
_(none — existing capabilities are consumed but not modified)_

## Impact

- **New package**: `packages/mcp-server` added to the monorepo
- **Backend changes**: New FTS5 table in SQLite, new search endpoint, new API key entity and auth guard, indexing hooks on file save/create/delete and file watcher events
- **Dependencies**: `@modelcontextprotocol/sdk` (mcp-server package), no new backend dependencies (FTS5 is built into SQLite)
- **API surface**: New `GET /api/files/search?q=...` endpoint, new `POST/GET/DELETE /api/auth/api-keys` endpoints
- **Configuration**: MCP server needs connection config to Kalepin backend (URL + API key)
