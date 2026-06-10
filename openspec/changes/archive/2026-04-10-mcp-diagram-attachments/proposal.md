## Why

When an LLM reads a note via the MCP `read_note` tool, draw.io diagrams are returned as raw decoded XML (~15,000+ tokens per diagram). This is expensive, low-precision (the LLM must regex-parse `mxCell` elements and guess the flow), and always included even when the task doesn't require understanding the diagram. A "lazy loading for LLMs" pattern — strip the XML, signal the diagram exists, let the LLM drill down on demand — would cut token cost by ~95% for diagram-containing notes and provide exact topology when needed.

## What Changes

- **`read_note` response**: Strip raw draw.io XML from note content. Replace each diagram with an inline placeholder `[diagram: <filename> (draw.io)]` preserving positional context. Add an `attachments` array to the response listing each attachment's id, type, and label.
- **New `read_attachment` tool**: Returns a structured representation of an attachment. For draw.io diagrams, parses `mxCell` elements into a graph JSON (`nodes` with id/label/type, `edges` with from/to/label). Accepts an optional `format` parameter (`structured` default, `image` for rendered PNG fallback).
- **Draw.io XML parser**: Server-side parser that walks `mxCell` elements, classifies vertices vs edges by `vertex="1"`/`edge="1"` attributes, extracts labels from `value`, and infers node types from style strings (`rhombus` → decision, `rounded` → process, etc.).

## Capabilities

### New Capabilities
- `mcp-read-attachment`: New MCP tool to read attachments in LLM-friendly formats (structured graph, image). Dispatches on attachment type for extensibility.
- `drawio-graph-parser`: Server-side parser converting draw.io XML (`mxCell` elements) into a structured node/edge graph representation.

### Modified Capabilities
- (none — `read_note` behavior change is implementation-level, not a spec-level requirement change to an existing capability)

## Impact

- **MCP server** (`packages/backend/src/mcp/mcp.service.ts`): Modify `extractDrawioDiagrams()` to return placeholders + metadata instead of raw XML. Register new `read_attachment` tool.
- **MCP tool consumers**: LLMs that previously relied on raw XML in `read_note` output will now see placeholders and need to call `read_attachment` for diagram content. This is a **BREAKING** change for any prompt that pattern-matches on `## draw.io Diagrams` sections.
- **Dependencies**: None new — draw.io XML parsing uses standard XML/DOM parsing already available in Node.
