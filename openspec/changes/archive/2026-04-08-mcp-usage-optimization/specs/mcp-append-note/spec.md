## ADDED Requirements

### Requirement: append_to_note MCP tool exists
The system SHALL expose an `append_to_note` tool via the MCP server. The tool SHALL accept `path` (string, required), `content` (string, required), `separator` (string, optional, default `"\n\n"`), and `base_hash` (string, optional) parameters.

#### Scenario: Tool is listed in MCP capabilities
- **WHEN** an MCP client lists available tools
- **THEN** `append_to_note` appears with a description indicating it appends content to an existing note

### Requirement: append_to_note appends content with separator
The tool SHALL read the existing note content and append the separator followed by the new content.

#### Scenario: Append with default separator
- **WHEN** user calls `append_to_note` with `content: "## New Section\n\nSome text"` on a note ending with "existing content"
- **THEN** the note content becomes "existing content\n\n## New Section\n\nSome text"

#### Scenario: Append with custom separator
- **WHEN** user calls `append_to_note` with `content: "- item"` and `separator: "\n"`
- **THEN** the new content is separated by a single newline

### Requirement: append_to_note rejects stale base_hash
When `base_hash` is provided, the tool SHALL compare it against the hash of the current document content before appending. If they differ, the tool SHALL reject the operation.

#### Scenario: Hash mismatch on append
- **WHEN** user calls `append_to_note` with a `base_hash` that does not match
- **THEN** the tool returns a conflict error and the document is unchanged

### Requirement: append_to_note fails on non-existent note
The tool SHALL return an error if the note does not exist, directing the user to `create_note`.

#### Scenario: Note does not exist
- **WHEN** user calls `append_to_note` on a path that resolves to no notes
- **THEN** the tool returns an error suggesting `create_note`

### Requirement: append_to_note uses fuzzy path resolution
The tool SHALL use the same fuzzy path resolution as other note tools.

#### Scenario: Ambiguous path
- **WHEN** user calls `append_to_note` with a path matching multiple notes
- **THEN** the tool returns an error listing the matching paths

### Requirement: append_to_note tracks changes
The tool SHALL track the append via `ChangeTrackingService` with a diff between old and new content.

#### Scenario: Append change is tracked
- **WHEN** an `append_to_note` operation succeeds
- **THEN** the change appears in `get_updates` with a diff showing the appended content
