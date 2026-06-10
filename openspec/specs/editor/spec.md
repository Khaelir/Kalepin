## Purpose

TipTap-based rich markdown editor with slash commands, file-tree sidebar, and comments panel.
## Requirements
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

### Requirement: Slash commands
The system SHALL provide slash commands for quick content insertion. V1 commands: `/table`, `/task`, `/heading`, `/divider`, `/code`, `/callout`, `/link`, `/mermaid`, `/drawio`.

#### Scenario: User types slash
- **WHEN** a user types `/` at the beginning of a line or after a space
- **THEN** a dropdown menu appears with available commands, filtered as the user types

#### Scenario: User selects a slash command
- **WHEN** a user selects `/table` from the slash command menu
- **THEN** the editor inserts a markdown table template at the cursor position

#### Scenario: Slash command renders rich but serializes to markdown
- **WHEN** a user inserts a `/callout` via slash command
- **THEN** the editor renders it as a styled callout block, but the file on disk contains standard markdown (e.g., blockquote syntax)

#### Scenario: User inserts draw.io diagram via slash command
- **WHEN** a user selects `/drawio` from the slash command menu
- **THEN** a new empty draw.io SVG is created and inserted as an image
- **THEN** the draw.io editor modal opens immediately

### Requirement: File tree sidebar
The system SHALL display a hierarchical file tree sidebar with support for drag/drop, search, and context menu operations.

#### Scenario: File tree displays vault structure
- **WHEN** a user opens the workspace
- **THEN** the sidebar displays all files and directories in a tree structure, excluding dot-prefixed files

#### Scenario: Drag and drop file
- **WHEN** a user drags a file to a different directory in the tree
- **THEN** the file (and its sidecar) are moved to the new location

#### Scenario: Context menu operations
- **WHEN** a user right-clicks a file or directory in the tree
- **THEN** a context menu appears with options: rename, delete, new file, new folder

#### Scenario: Search files
- **WHEN** a user types in the file tree search box
- **THEN** the tree filters to show only files/directories matching the search query

### Requirement: Comments panel
The system SHALL display a comments panel alongside the editor showing all comment threads for the current document.

#### Scenario: View comments
- **WHEN** a user opens a document with existing comments
- **THEN** the comments panel shows all threads, grouped by their anchored block, with resolved threads collapsed

#### Scenario: Click comment to navigate
- **WHEN** a user clicks a comment thread in the panel
- **THEN** the editor scrolls to the anchored block in the document

### Requirement: Image extension draw.io awareness
The image extension SHALL detect draw.io SVGs and provide additional actions.

#### Scenario: Image extension renders draw.io SVG
- **WHEN** the `ImageWithAttachments` extension renders an SVG that contains draw.io metadata
- **THEN** a "draw.io" badge and "Edit" action button are added to the hover action bar
- **THEN** clicking "Edit" opens the fullscreen draw.io editor modal

#### Scenario: Code block draw.io detection
- **WHEN** a code block contains draw.io XML (`<mxfile` or `<mxGraphModel`)
- **THEN** an informational banner is shown guiding the user to export as SVG

