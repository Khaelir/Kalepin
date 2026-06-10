## ADDED Requirements

### Requirement: MCP server process
The system SHALL provide an MCP server (in `packages/mcp-server`) that communicates over stdio transport using the Model Context Protocol JSON-RPC format. It SHALL connect to the Kalepin backend via REST API using an API key for authentication.

#### Scenario: Start MCP server
- **WHEN** the MCP server is launched with `KALEPIN_URL` and `KALEPIN_API_KEY` environment variables
- **THEN** it connects to the backend, verifies connectivity, and begins accepting MCP requests over stdio

#### Scenario: Backend unreachable
- **WHEN** the MCP server cannot reach the Kalepin backend
- **THEN** it returns clear error messages for any tool/resource calls indicating the backend is unavailable

### Requirement: Search notes tool
The MCP server SHALL expose a `search_notes` tool that performs full-text search across all notes.

#### Scenario: Search for notes
- **WHEN** an MCP client calls `search_notes` with `{ "query": "Device LwM2M object" }`
- **THEN** the tool returns ranked results with path, snippet, and score for each matching note

#### Scenario: Search with no matches
- **WHEN** an MCP client calls `search_notes` with a query matching no notes
- **THEN** the tool returns an empty results array

### Requirement: Read note tool
The MCP server SHALL expose a `read_note` tool that returns the full markdown content of a note.

#### Scenario: Read existing note
- **WHEN** an MCP client calls `read_note` with `{ "path": "projects/design.md" }`
- **THEN** the tool returns the full markdown content of that note

#### Scenario: Read non-existent note
- **WHEN** an MCP client calls `read_note` with a path that does not exist
- **THEN** the tool returns an error indicating the note was not found

### Requirement: List files tool
The MCP server SHALL expose a `list_files` tool that returns the file tree.

#### Scenario: List all files
- **WHEN** an MCP client calls `list_files` with no arguments
- **THEN** the tool returns the full directory tree of notes

#### Scenario: List subdirectory
- **WHEN** an MCP client calls `list_files` with `{ "path": "projects/" }`
- **THEN** the tool returns only files and directories under "projects/"

### Requirement: Create note tool
The MCP server SHALL expose a `create_note` tool for creating new notes.

#### Scenario: Create a note
- **WHEN** an MCP client calls `create_note` with `{ "path": "ideas/new-idea.md", "content": "# New Idea\n..." }`
- **THEN** the note is created and the tool confirms success

### Requirement: Edit note tool
The MCP server SHALL expose an `edit_note` tool for updating existing notes.

#### Scenario: Edit a note
- **WHEN** an MCP client calls `edit_note` with `{ "path": "projects/design.md", "content": "updated content" }`
- **THEN** the note content is replaced and the tool confirms success

### Requirement: Delete note tool
The MCP server SHALL expose a `delete_note` tool for removing notes.

#### Scenario: Delete a note
- **WHEN** an MCP client calls `delete_note` with `{ "path": "old-draft.md" }`
- **THEN** the note is deleted and the tool confirms success

### Requirement: List comments tool
The MCP server SHALL expose a `list_comments` tool for reading comments on a note.

#### Scenario: List comments on a note
- **WHEN** an MCP client calls `list_comments` with `{ "path": "projects/design.md" }`
- **THEN** the tool returns all comment threads associated with that note

### Requirement: Add comment tool
The MCP server SHALL expose an `add_comment` tool for adding comments to notes.

#### Scenario: Add a comment
- **WHEN** an MCP client calls `add_comment` with `{ "path": "projects/design.md", "content": "Consider adding error handling here" }`
- **THEN** a new comment is added to the note and the tool confirms success

### Requirement: Note resource
The MCP server SHALL expose notes as MCP resources with URI pattern `note://{path}`.

#### Scenario: Read note as resource
- **WHEN** an MCP client requests the resource `note://projects/design.md`
- **THEN** the server returns the note content as a text resource with `text/markdown` MIME type

### Requirement: File tree resource
The MCP server SHALL expose the file tree as an MCP resource with URI `tree://`.

#### Scenario: Browse file tree
- **WHEN** an MCP client requests the resource `tree://`
- **THEN** the server returns the complete file tree as a JSON resource

### Requirement: Summarize notes prompt
The MCP server SHALL expose a `summarize-notes` prompt template.

#### Scenario: Use summarize prompt
- **WHEN** an MCP client requests the `summarize-notes` prompt with `{ "path": "projects/" }`
- **THEN** the server returns a prompt that includes the content of all notes in the specified path, with instructions to summarize them

### Requirement: Review doc prompt
The MCP server SHALL expose a `review-doc` prompt template.

#### Scenario: Use review prompt
- **WHEN** an MCP client requests the `review-doc` prompt with `{ "path": "projects/design.md" }`
- **THEN** the server returns a prompt that includes the note content with instructions to review it and provide feedback
