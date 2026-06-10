## Purpose

Registers MCP tools with scope-aware gating so each API key only sees tools it is allowed to use.

## Requirements

### Requirement: Scope-aware tool registration
The MCP server SHALL register tools based on the API key scope at session initialization.

#### Scenario: Read-only API key
- **WHEN** an MCP session is initialized with a `notes:read` scoped key
- **THEN** only read tools are registered: `search_notes`, `read_note`, `read_attachment`, `list_files`, `list_comments`, `get_updates`
- **AND** write tools (`create_note`, `patch_note`, `append_to_note`, `edit_note`, `delete_note`, `add_comment`, `resolve_comment`) are NOT registered

#### Scenario: Write API key
- **WHEN** an MCP session is initialized with a `notes:write` (or broader) scoped key
- **THEN** both read and write tools are registered

#### Scenario: Admin API key
- **WHEN** an MCP session is initialized with an `admin` scoped key
- **THEN** read tools, write tools, admin tools (`list_backups`, `create_backup`, `restore_backup`, `mcp_stats`) are all registered

### Requirement: Remove runtime scope check from admin tools
Since admin tools are only registered for admin keys, the existing runtime check (`if (user.scope !== 'admin')`) inside admin tool handlers MAY be kept as defense-in-depth but is no longer the primary access control.
