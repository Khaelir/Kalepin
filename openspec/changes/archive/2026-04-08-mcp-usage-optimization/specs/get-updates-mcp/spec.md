## MODIFIED Requirements

### Requirement: get_updates MCP tool exists
The system SHALL expose a `get_updates` tool via both the HTTP MCP service and the stdio MCP server. The tool SHALL require authentication.

#### Scenario: Tool is listed in MCP capabilities
- **WHEN** an MCP client lists available tools
- **THEN** `get_updates` appears with a description indicating it returns recent note changes

## ADDED Requirements

### Requirement: edit_note description nudges toward patch_note
The `edit_note` tool description SHALL explicitly recommend using `patch_note` for small or targeted edits. The description SHALL indicate that `edit_note` replaces the full document content and is intended for complete rewrites only.

#### Scenario: edit_note description text
- **WHEN** an MCP client reads the `edit_note` tool description
- **THEN** the description contains guidance to prefer `patch_note` for small edits and states that `edit_note` replaces the entire document

### Requirement: read_note response includes contentHash
The `read_note` tool response SHALL include a `contentHash` line so that subsequent `edit_note`, `patch_note`, or `append_to_note` calls can pass it as `base_hash` for conflict detection.

#### Scenario: contentHash in read_note output
- **WHEN** user calls `read_note` on an existing note
- **THEN** the response includes a `contentHash: <hash>` line that can be passed to write tools
