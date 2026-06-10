# mermaid-render Specification

## Purpose
TBD - created by archiving change mermaid-visualizer. Update Purpose after archive.
## Requirements
### Requirement: Mermaid code blocks render as diagrams
Code blocks with language `mermaid` SHALL render as SVG diagrams by default in the WYSIWYG editor. The rendered diagram SHALL replace the raw code view. All mermaid diagram types (flowchart, sequence, class, state, ER, gantt, pie, etc.) SHALL be supported.

#### Scenario: Mermaid block renders on document load
- **WHEN** a document containing a ` ```mermaid ` code block is opened
- **THEN** the code block renders as an SVG diagram instead of showing raw mermaid text

#### Scenario: Non-mermaid code blocks are unaffected
- **WHEN** a document contains code blocks with other languages (e.g., `javascript`, `python`)
- **THEN** those code blocks render with syntax highlighting as before

#### Scenario: Raw markdown mode shows plain text
- **WHEN** the editor is in raw markdown mode
- **THEN** mermaid blocks display as plain ` ```mermaid ` text with no rendering

### Requirement: Toggle between rendered view and source editing
Each mermaid block SHALL have a toggle button to switch between rendered SVG view and source code editing. The default state SHALL be rendered view.

#### Scenario: Toggle to source editing
- **WHEN** the user clicks the code toggle button on a rendered mermaid block
- **THEN** the rendered diagram is replaced with an editable code block showing the mermaid source

#### Scenario: Toggle back to rendered view
- **WHEN** the user clicks the preview toggle button while in source editing mode
- **THEN** the mermaid source is re-rendered as an SVG diagram

#### Scenario: Default state is rendered
- **WHEN** a mermaid block is first displayed (document load or insertion)
- **THEN** it SHALL be in rendered view, not source editing mode

### Requirement: Re-render on blur
When a mermaid block loses focus after source editing, the diagram SHALL automatically re-render with the updated source.

#### Scenario: User edits and clicks away
- **WHEN** the user is editing mermaid source and clicks outside the code block
- **THEN** the block switches to rendered view with the updated diagram

#### Scenario: No re-render while typing
- **WHEN** the user is actively typing in the mermaid source editor
- **THEN** no rendering occurs until the block loses focus or the user toggles manually

### Requirement: Error handling for invalid syntax
The system SHALL handle invalid mermaid syntax gracefully without breaking the editor.

#### Scenario: Invalid syntax with previous valid render
- **WHEN** the user edits mermaid source to be invalid after having a valid diagram
- **THEN** the last valid SVG render is shown dimmed with an error badge

#### Scenario: Invalid syntax on fresh block
- **WHEN** a mermaid block has never rendered successfully and contains invalid syntax
- **THEN** an inline error message is displayed describing the parse error

#### Scenario: Syntax becomes valid again
- **WHEN** the user fixes previously invalid mermaid syntax
- **THEN** the diagram renders normally with no error indicators

### Requirement: Lazy loading of mermaid library
The mermaid.js library SHALL be loaded lazily via dynamic import only when the first mermaid code block is encountered.

#### Scenario: No mermaid blocks in document
- **WHEN** a document has no mermaid code blocks
- **THEN** the mermaid library is NOT loaded

#### Scenario: First mermaid block triggers load
- **WHEN** the first mermaid code block is encountered (on document load or insertion)
- **THEN** the mermaid library is dynamically imported
- **THEN** a loading spinner is shown while the library loads

#### Scenario: Subsequent mermaid blocks reuse loaded library
- **WHEN** additional mermaid blocks are encountered after the library has loaded
- **THEN** they render immediately without another loading state

### Requirement: Mermaid security configuration
Mermaid SHALL be initialized with `securityLevel: 'strict'` to prevent XSS from diagram content.

#### Scenario: Diagram with script content
- **WHEN** a mermaid block contains potentially malicious content
- **THEN** the strict security level sanitizes the output SVG

