## Context

The Kalepin MCP server (`packages/backend/src/mcp/mcp.service.ts`) exposes a `read_note` tool that returns full markdown content. When a note references draw.io SVG attachments, the `extractDrawioDiagrams()` method (line 78) fetches each SVG, extracts the `content` attribute, HTML-decodes it, and appends the raw `mxGraphModel` XML in a `## draw.io Diagrams` section. This costs ~15,000+ tokens per diagram with low precision — the LLM must regex-parse `mxCell` elements to understand the flow.

The MCP already has the plumbing: SVG references are detected via regex, attachments are fetched via `AttachmentsService.serve()`, and draw.io content is identified by `mxGraphModel`/`mxfile` markers.

## Goals / Non-Goals

**Goals:**
- Reduce token cost of `read_note` for diagram-containing notes by ~95%
- Give the LLM exact graph topology (nodes, edges, labels) when it needs diagram content
- Preserve positional context — the LLM knows where in the document a diagram sits
- Make the LLM opt-in to reading diagram detail (lazy loading pattern)
- Future-proof for other attachment types via a generic `read_attachment` tool

**Non-Goals:**
- Supporting diagram formats other than draw.io (future work)
- Returning rendered images from `read_attachment` (deferred — `format=image` accepted but returns structured for now)
- Modifying how draw.io diagrams are stored or edited in Kalepin
- Changing the draw.io editor or SVG rendering pipeline

## Decisions

### 1. Strip + signal in `read_note` (not a separate pre-filter)

Modify `extractDrawioDiagrams()` to return placeholder metadata instead of raw XML. The method already identifies draw.io SVGs — change its output from appended XML to:
- Inline placeholder in the markdown: `[diagram: <filename> (draw.io)]` inserted at the SVG reference location
- An attachments metadata array: `{ id, type, label }` per diagram

**Why not a separate pre-filter tool?** The existing method already does detection. Splitting it into two tools (detect, then strip) adds a round-trip for every `read_note` call. Doing it inline is zero-cost.

**Alternative considered:** Keep raw XML but truncate. Rejected — truncation loses topology, and the LLM still can't follow edges without full context.

### 2. New `read_attachment` tool with structured graph output

Register a new MCP tool `read_attachment` that:
- Takes `notePath` (to locate attachments) and `attachmentId` (the SVG filename)
- Fetches the SVG via `AttachmentsService.serve()`
- Parses the draw.io XML into a `{ nodes, edges }` graph

**Why a separate tool (not a parameter on read_note)?** The LLM should pay the parsing cost only when it needs diagram understanding. Many tasks (editing prose, checking comments) don't require it.

### 3. Parse `mxCell` elements into typed graph

The draw.io XML structure is well-defined:
- `mxCell` with `vertex="1"` → node. Label from `value` attribute.
- `mxCell` with `edge="1"` → edge. `source`/`target` reference vertex IDs.
- Style string encodes shape: `rhombus` → decision, `rounded=1;` → process, `shape=ellipse` → start/end, default → process.

Use a simple XML parser (e.g., `fast-xml-parser` already in deps, or built-in DOMParser) to walk `mxCell` elements. No need for a full draw.io renderer.

**Node type mapping:**

| Style pattern | Node type |
|---|---|
| `rhombus` | decision |
| `shape=ellipse` | terminal |
| `rounded=1` | process |
| `shape=cylinder` | datastore |
| (default) | process |

### 4. Response format for `read_note` attachments metadata

Embed the attachments array in the text response as a structured header, not as a separate MCP content block. The MCP SDK returns `{ content: [{ type: 'text', text }] }` — adding a second content block with `type: 'resource'` would require MCP client support. Instead, prepend a machine-readable JSON line:

```
contentHash: abc123
attachments: [{"id":"flow.svg","type":"diagram/drawio","label":"flow.svg"}]
[Open in Kalepin](...)

# My Note
...
[diagram: flow.svg (draw.io)]
...
```

This keeps backwards compatibility with the existing text format while adding structured discovery.

### 5. Inline placeholder replaces SVG markdown reference

Currently notes contain `![](/_attachments/flow.svg)` in the markdown. Replace this with `[diagram: flow.svg (draw.io)]` in the `read_note` output (not in the stored file). The original markdown reference is preserved on disk.

## Risks / Trade-offs

- **Breaking change for prompt patterns**: Any LLM prompt that pattern-matches `## draw.io Diagrams` or expects raw XML in `read_note` output will break. → Mitigation: This is the Kalepin MCP consumed by the project owner; no external consumers. Update any prompt templates that reference the old format.
- **XML parsing edge cases**: Complex draw.io diagrams may have nested `mxCell` elements, groups, or layers that complicate parsing. → Mitigation: Start with flat cell parsing (vertex/edge classification). Nested groups can be flattened — their children are still individual `mxCell` elements with explicit `source`/`target`.
- **Style string fragility**: Node type classification depends on parsing style strings which are not formally documented. → Mitigation: Default to `process` for unrecognized styles. The label and edge topology are the high-value outputs; node type is a best-effort hint.
- **Multi-page diagrams**: draw.io supports multiple pages in a single file. → Mitigation: Parse all pages, return nodes/edges with a `page` field if multiple pages detected.
