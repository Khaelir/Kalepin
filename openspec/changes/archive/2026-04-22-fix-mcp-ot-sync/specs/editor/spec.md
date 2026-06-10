## MODIFIED Requirements

### Requirement: Rich markdown editor
The system SHALL provide a TipTap-based rich text editor that renders markdown with formatting (headings, bold, italic, lists, code blocks, links, etc.) while serializing to pure markdown on save. The `file:changed` WebSocket handler SHALL use a ref to track the current active file, ensuring external change detection works regardless of when the document was opened.

#### Scenario: User opens a markdown file
- **WHEN** a user opens a markdown file
- **THEN** the editor renders the markdown content with rich formatting (headings styled, code blocks highlighted, etc.)

#### Scenario: User edits content
- **WHEN** a user types or formats text in the editor
- **THEN** the changes are represented as ProseMirror transactions and serialized to markdown

#### Scenario: External file change detected for current document
- **WHEN** a `file:changed` WebSocket message arrives with a path matching the currently active file
- **THEN** the editor reloads the file content from the server, regardless of when the file was originally opened
