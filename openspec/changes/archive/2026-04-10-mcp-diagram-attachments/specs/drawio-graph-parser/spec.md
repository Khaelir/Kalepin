## ADDED Requirements

### Requirement: Parse draw.io XML into node/edge graph
The parser SHALL accept decoded draw.io XML (containing `mxGraphModel` or `mxfile`) and return a structured graph with `nodes` and `edges` arrays.

#### Scenario: Simple flowchart with vertices and edges
- **WHEN** the parser receives draw.io XML containing `mxCell` elements with `vertex="1"` and `edge="1"` attributes
- **THEN** it returns `nodes` for each vertex cell (with `id`, `label` from `value` attribute, and `type` derived from style) and `edges` for each edge cell (with `from` from `source` attribute, `to` from `target` attribute, and `label` from `value` attribute)

#### Scenario: Empty or invalid XML
- **WHEN** the parser receives XML that contains no `mxCell` elements with vertex or edge attributes
- **THEN** it returns `{ nodes: [], edges: [] }`

### Requirement: Classify node types from style strings
The parser SHALL derive a node `type` from the `mxCell` `style` attribute using the following mapping:

| Style pattern | Node type |
|---|---|
| Contains `rhombus` | `decision` |
| Contains `shape=ellipse` | `terminal` |
| Contains `rounded=1` | `process` |
| Contains `shape=cylinder` | `datastore` |
| No match | `process` |

#### Scenario: Decision node (rhombus)
- **WHEN** a vertex `mxCell` has `style` containing `rhombus`
- **THEN** the corresponding node has `type: "decision"`

#### Scenario: Default to process type
- **WHEN** a vertex `mxCell` has a `style` that does not match any known pattern
- **THEN** the corresponding node has `type: "process"`

### Requirement: Handle multi-page diagrams
The parser SHALL handle draw.io files containing multiple `<diagram>` elements (pages). Each node and edge SHALL include a `page` field (0-indexed) when multiple pages are present.

#### Scenario: Single-page diagram
- **WHEN** the XML contains a single `<diagram>` element
- **THEN** nodes and edges do not include a `page` field

#### Scenario: Multi-page diagram
- **WHEN** the XML contains multiple `<diagram>` elements
- **THEN** each node and edge includes a `page` field indicating which page (0-indexed) it belongs to

### Requirement: Handle HTML labels
The parser SHALL strip HTML tags from `mxCell` `value` attributes that contain HTML markup, returning plain text labels.

#### Scenario: HTML-formatted label
- **WHEN** a vertex `mxCell` has `value="<b>Login</b><br>Service"`
- **THEN** the corresponding node has `label: "Login Service"` (HTML stripped, `<br>` converted to space)

#### Scenario: Plain text label
- **WHEN** a vertex `mxCell` has `value="POST /api/auth"`
- **THEN** the corresponding node has `label: "POST /api/auth"` (unchanged)
