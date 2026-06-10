## MODIFIED Requirements

### Requirement: MCP server process
The system SHALL provide an MCP server (in `packages/mcp-server`) that communicates over stdio transport using the Model Context Protocol JSON-RPC format. It SHALL connect to the Kalepin backend via REST API using an API key for authentication. On startup, it SHALL call `GET /api/auth/api-keys/whoami` to discover the key's scope and permissions, and SHALL only register tools that the key's permissions allow.

#### Scenario: Start MCP server with read-only key
- **WHEN** the MCP server is launched with a `KALEPIN_API_KEY` that has scope `ro`
- **THEN** it registers only read tools (`search_notes`, `read_note`, `list_files`, `list_comments`, `get_updates`) and omits write tools (`create_note`, `edit_note`, `delete_note`, `add_comment`)

#### Scenario: Start MCP server with read + comments key
- **WHEN** the MCP server is launched with a `KALEPIN_API_KEY` that has scope `rc`
- **THEN** it registers read tools plus `add_comment`, and omits `create_note`, `edit_note`, `delete_note`

#### Scenario: Start MCP server with full access key
- **WHEN** the MCP server is launched with a `KALEPIN_API_KEY` that has scope `rw`
- **THEN** it registers all tools (same behavior as today)

#### Scenario: Backend unreachable at startup
- **WHEN** the MCP server cannot reach the Kalepin backend during the `/whoami` call
- **THEN** it exits with a clear error message indicating the backend is unavailable
