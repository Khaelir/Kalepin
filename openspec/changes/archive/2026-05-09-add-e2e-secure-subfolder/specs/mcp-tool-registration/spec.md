# Spec delta: mcp-tool-registration (MODIFIED)

## MODIFIED Requirements

### Requirement: MCP read tools return a sentinel for E2E paths

MCP tools that read or surface content (`read_note`, `search_notes`, `get_updates`, `read_attachment`, `list_comments`) SHALL detect `isE2EEncrypted` paths and return `{ kind: 'e2e-encrypted', path }` instead of plaintext or path-derived content.

#### Scenario: MCP read returns sentinel
- **WHEN** an MCP-connected agent calls `read_note` for `_users/alice/_secure/foo.md`
- **THEN** the response is `{ kind: 'e2e-encrypted', path: '_users/alice/_secure/foo.md' }` with no content

#### Scenario: MCP search excludes E2E paths
- **WHEN** an MCP `search_notes` call would otherwise match an E2E path (it cannot, because FTS is empty for these — but a tree-prefix search might)
- **THEN** the result list omits E2E paths entirely

### Requirement: MCP write tools reject E2E paths

MCP tools that write (`create_note`, `edit_note`, `patch_note`, `append_to_note`, `delete_note`) SHALL reject `isE2EEncrypted` paths with a clear error: "MCP cannot write to end-to-end encrypted folders. Use the web UI."

#### Scenario: MCP write rejected
- **WHEN** an MCP agent calls `edit_note` for an E2E path
- **THEN** the response is an error with the explanation
