## Purpose

Exposes a `list_files` MCP tool returning a flat list of workspace file paths.

## Requirements

### Requirement: Flat path output for MCP
The MCP `list_files` tool SHALL return a newline-separated list of file paths (markdown files only, no directory entries). The REST API `GET /api/files/tree` continues to return the nested `FileEntry[]` tree unchanged.

#### Scenario: MCP list_files
- **WHEN** `list_files` is called via MCP
- **THEN** the response is a plain text string with one file path per line, e.g.:
  ```
  Environment/Redin 5/Tuyau HTTP/Choix architecture securite.md
  Environment/Redin 5/Tuyau HTTP/Historique choix securite.md
  Environment/SSO - POC/POC - SSO - Formatted.md
  ```

#### Scenario: MCP list_files with path filter
- **WHEN** `list_files` is called with `path: "Environment/Redin 5"`
- **THEN** only paths under that directory are returned

#### Scenario: REST API tree endpoint
- **WHEN** `GET /api/files/tree` is called
- **THEN** the nested `FileEntry[]` JSON tree is returned (unchanged)
