## ADDED Requirements

### Requirement: read_attachment tool returns structured attachment content
The MCP server SHALL expose a `read_attachment` tool that accepts a note path, attachment ID, and optional format parameter. It SHALL return a structured representation of the attachment appropriate to its type. For draw.io diagrams, it SHALL return a JSON graph with nodes and edges.

#### Scenario: Read a draw.io diagram attachment as structured graph
- **WHEN** `read_attachment` is called with a valid note path and attachment ID referencing a draw.io SVG
- **THEN** the tool returns a JSON object with `type: "diagram/drawio"` and a `graph` field containing `nodes` (array of `{ id, label, type }`) and `edges` (array of `{ from, to, label }`)

#### Scenario: Attachment not found
- **WHEN** `read_attachment` is called with an attachment ID that does not exist or is not referenced by the note
- **THEN** the tool returns an error message indicating the attachment was not found

#### Scenario: Unsupported attachment type
- **WHEN** `read_attachment` is called for a non-draw.io SVG or a non-SVG attachment
- **THEN** the tool returns an error message indicating the attachment type is not supported for structured reading

### Requirement: read_note strips diagram XML and inserts placeholders
The `read_note` tool SHALL NOT return raw draw.io XML in its output. Instead, it SHALL replace each draw.io SVG reference with an inline placeholder `[diagram: <filename> (draw.io)]` at the reference location in the markdown. The original markdown file on disk SHALL NOT be modified.

#### Scenario: Note with one draw.io diagram
- **WHEN** `read_note` is called for a note containing `![](/_attachments/flow.svg)` where `flow.svg` is a draw.io diagram
- **THEN** the returned content contains `[diagram: flow.svg (draw.io)]` at the reference location instead of the image markdown, and no raw XML section is appended

#### Scenario: Note with multiple draw.io diagrams
- **WHEN** `read_note` is called for a note containing references to multiple draw.io SVGs
- **THEN** each reference is replaced with its own `[diagram: <filename> (draw.io)]` placeholder, and no raw XML section is appended

#### Scenario: Note with no diagrams
- **WHEN** `read_note` is called for a note with no SVG attachments
- **THEN** the response is unchanged from current behavior (no placeholders, no attachments metadata)

### Requirement: read_note returns attachments metadata
When a note contains draw.io diagram attachments, the `read_note` response SHALL include an `attachments` line in the header listing each attachment as a JSON array with `id`, `type`, and `label` fields.

#### Scenario: Attachments metadata in response
- **WHEN** `read_note` is called for a note with two draw.io diagrams (`flow.svg` and `arch.svg`)
- **THEN** the response text includes a line `attachments: [{"id":"flow.svg","type":"diagram/drawio","label":"flow.svg"},{"id":"arch.svg","type":"diagram/drawio","label":"arch.svg"}]` before the note content

#### Scenario: No attachments metadata when no diagrams
- **WHEN** `read_note` is called for a note with no draw.io diagrams
- **THEN** the response text does not include an `attachments` line
