## MODIFIED Requirements

### Requirement: Compact sequential node IDs
`read_attachment` SHALL replace draw.io UUIDs with compact sequential IDs (`n1`, `n2`, ...) in the graph output. Edge `from`/`to` references SHALL use the same compact IDs.

#### Scenario: Node ID mapping
- **WHEN** a diagram has a node with draw.io ID `"8pqnUvXt2sdNWuhrvl4b-41"`
- **THEN** the node appears with ID `"n1"` (or next sequential), and all edges referencing it use `"n1"`

### Requirement: HTML entity and tag cleanup in labels
Node labels SHALL have HTML entities decoded (`&#39;` → `'`, `&nbsp;` → ` `, `&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`) and HTML tags stripped (`<span>`, `<font>`, `<br>`, etc.).

#### Scenario: Label with HTML artifacts
- **GIVEN** a node with label `"Redirection HTTP 302redirect_uri&nbsp;<span style=\"font-size: 11px\">test</span>"`
- **WHEN** `read_attachment` returns the graph
- **THEN** the label is `"Redirection HTTP 302redirect_uri test"`

### Requirement: Filter empty and broken edges
Edges where `from` or `to` is an empty string SHALL be excluded from the graph output.

#### Scenario: Edge with empty source
- **GIVEN** an edge with `from: ""` and `to: "8pqnUvXt2sdNWuhrvl4b-6"`
- **WHEN** `read_attachment` returns the graph
- **THEN** this edge is not included in the `edges` array
