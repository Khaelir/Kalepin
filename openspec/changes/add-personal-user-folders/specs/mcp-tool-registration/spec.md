## MODIFIED Requirements

### Requirement: All MCP tools that accept a path argument thread the user's email into leaf calls

Every MCP tool whose input schema contains a `path`, `notePath`, `parent_path`, or any other path-bearing argument SHALL pass `user.email.toLowerCase()` into the underlying service call (`SearchService.search`, `FilesService.readFile`/`writeFile`/`listTree`, `LinkIndexService.*`, `ChangeTrackingService.getChangesSince`, `AttachmentsService.serve`). The wrapping helper `wrapTool` SHALL enforce this at registration time.

#### Scenario: Search by foreign personal token via MCP returns no hits
- **WHEN** Bob's MCP client calls `search_notes` with a query matching the body of Alice's personal note
- **THEN** the tool response contains zero hits referencing `_users/alice@example.com/...`

#### Scenario: Read foreign personal note via MCP returns 404-equivalent
- **WHEN** Bob's MCP client calls `read_note` with `path = "_users/alice@example.com/Diary.md"`
- **THEN** the tool returns the same not-found error string used for nonexistent paths

#### Scenario: List foreign personal directory via MCP returns nothing
- **WHEN** Bob's MCP client calls `list_files` with `path = "_users/alice@example.com"`
- **THEN** the tool returns an empty result equivalent to a nonexistent path

#### Scenario: Write into foreign personal path via MCP rejected
- **WHEN** Bob's MCP client calls `create_note`, `edit_note`, `patch_note`, `append_to_note`, or `delete_note` with a foreign personal path
- **THEN** the tool returns the not-found error and the underlying file is unchanged

#### Scenario: Read foreign personal attachment via MCP rejected
- **WHEN** Bob's MCP client calls `read_attachment` with a `notePath` under `_users/alice@example.com/`
- **THEN** the tool returns the not-found error and no bytes are returned

#### Scenario: get_updates excludes foreign personal changes
- **WHEN** Bob's MCP client calls `get_updates` after Alice modifies a personal note
- **THEN** the tool response excludes the personal-note path and any diff derived from it

### Requirement: Registration-time enforcement of email threading

`wrapTool(toolName, user, handler)` SHALL inspect each registered tool's input schema. If a tool declares a path-bearing argument and the registered handler does not consume `user.email`, registration SHALL fail at backend boot with a typed error.

#### Scenario: Tool missing email threading fails to register
- **WHEN** a tool is registered whose input schema contains `path` but whose handler does not pass `user.email` into its leaf calls
- **THEN** backend boot fails with a clear error message naming the tool

#### Scenario: Tools without path arguments register normally
- **WHEN** a tool has no path-bearing argument (e.g. `mcp_stats`)
- **THEN** registration succeeds without requiring email threading

### Requirement: MCP tool discovery surface for the leak-token e2e suite

The system SHALL expose a method `getRegisteredTools(): { name: string; inputSchema: object }[]` on the MCP service so that the e2e leak-token suite can enumerate tools programmatically and assert coverage.

#### Scenario: Discovery returns the full tool registry
- **WHEN** the e2e suite calls `mcpService.getRegisteredTools()`
- **THEN** the returned list contains every tool registered with the MCP server, including new tools added in subsequent changes
