## 1. Draw.io Graph Parser

- [x] 1.1 Create `drawio-graph-parser.ts` utility in `packages/backend/src/mcp/` that parses decoded draw.io XML into `{ nodes: { id, label, type }[], edges: { from, to, label }[] }` by walking `mxCell` elements
- [x] 1.2 Implement node type classification from style strings (rhombus→decision, ellipse→terminal, rounded→process, cylinder→datastore, default→process)
- [x] 1.3 Handle HTML labels — strip HTML tags from `value` attributes, convert `<br>` to spaces
- [x] 1.4 Handle multi-page diagrams — detect multiple `<diagram>` elements and add `page` field to nodes/edges
- [x] 1.5 Add unit tests for the parser: simple flowchart, multi-page, HTML labels, empty XML, edge cases

## 2. Modify `read_note` — Strip + Signal

- [x] 2.1 Refactor `extractDrawioDiagrams()` to return structured metadata (array of `{ id, type, label }`) instead of raw XML string
- [x] 2.2 Replace SVG markdown references (`![](/_attachments/X.svg)`) with inline placeholders `[diagram: X (draw.io)]` in the returned content (not on disk)
- [x] 2.3 Add `attachments:` JSON line to `read_note` response header when diagrams are present
- [x] 2.4 Remove the `## draw.io Diagrams` raw XML section from `read_note` output
- [x] 2.5 Verify notes without diagrams are unaffected (no placeholder, no attachments line)

## 3. New `read_attachment` Tool

- [x] 3.1 Register `read_attachment` tool in `createMcpServer()` with input schema: `notePath`, `attachmentId`, optional `format`
- [x] 3.2 Implement handler: fetch SVG via `AttachmentsService.serve()`, extract draw.io XML, pass to graph parser, return typed response
- [x] 3.3 Handle error cases: attachment not found, not a draw.io SVG, unsupported format
- [x] 3.4 Add `read_attachment` to MCP tool descriptions/documentation

## 4. Integration Testing

- [x] 4.1 Test `read_note` with a note containing draw.io SVG — verify placeholder in content and attachments metadata in header
- [x] 4.2 Test `read_attachment` end-to-end — verify structured graph output matches diagram content
- [x] 4.3 Test round-trip: `read_note` → discover attachment → `read_attachment` → verify topology
