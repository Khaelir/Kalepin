## Why

Backlinks already surface note connections as flat lists, but lists hide spatial relationships -- clusters of related notes, bridge notes connecting distant topics, orphans drifting without connections, and stale hubs that need attention. A graph view makes these patterns visible at a glance, turning the link index into a navigable map of knowledge structure.

This is a utility-first feature: the graph must help users discover, navigate, and maintain their notes. Looking pretty is a bonus, not the goal.

## What Changes

### Local graph panel (primary, V1)

A graph visualization in the right sidebar, showing the current note and its neighborhood (1-2 hops). This is the daily-use tool.

- **Lives in the right panel** alongside Backlinks, Comments, and Version History (one panel at a time, same toggle pattern)
- **Backlinks integration**: the graph can also be accessed as a visual mode toggle within the BacklinksPanel ("List | Graph"), making it immediately discoverable since users already know where backlinks live
- **Click-to-navigate**: clicking a node opens that note in the editor and smoothly re-centers the graph around it (animated transition, not a jarring re-render)
- **Labels on hover**: nodes are dots by default (300px panel is too tight for permanent labels). Hovering a node shows the note title. The current note's label is always visible.
- **Tooltip on hover**: shows note title, backlink/outgoing count, and last-modified age
- **Staleness coloring**: nodes fade from bright to dim based on how recently they were edited -- a visual prompt that a linked note may be outdated
- **Super-hub protection**: if a note has 30+ direct connections, cap visible nodes at ~25 most relevant (by recency + link count) with a "+N more" indicator
- **Pop-out button**: expand the local graph to full-screen, centered on the same note -- smooth transition into global view

### Global graph view (V2, builds on V1)

A full-screen view replacing the editor area (same pattern as Settings and Changes views). For occasional "gardening" sessions.

- **All notes as nodes, all links as edges** -- force-directed layout
- **Orphan highlighting**: notes with zero inbound links get a distinct visual treatment (hollow outline or accent color) -- these need connecting
- **Staleness gradient**: same as local graph but more impactful at scale -- creates a heatmap of fresh vs forgotten across the whole vault
- **Node size by degree**: highly-connected notes appear larger -- identifies hubs/MOCs naturally
- **Click-to-navigate**: clicking opens the note, optionally switching back to editor view
- **Zoom and pan**: standard canvas/WebGL interaction
- **Search/filter**: type to highlight a node in the graph, dimming everything else

### Backend: graph endpoint

- `GET /api/links/graph` -- returns all nodes (note paths) and edges (links between them) for the full vault
- `GET /api/links/graph?path=X&depth=2` -- returns the subgraph within N hops of a given note
- Each node includes: path, title (derived from filename), inbound link count, outbound link count, last modified timestamp
- Last modified derived from `note_changes` table (most recent change per path), with fallback to file system mtime via storage adapter

## Capabilities

### New Capabilities
- `graph-view`: Interactive force-directed graph visualization of note connections, available as a right sidebar panel (local, note-centered) and full-screen view (global, vault-wide). Includes visual signals for orphan status and staleness.

### Modified Capabilities
- `backlinks-ui`: Add a "List | Graph" toggle to the BacklinksPanel header, allowing users to switch between the existing list view and the new graph view within the same panel slot.
- `link-index`: Add graph query endpoints that return nodes and edges in a format suitable for graph rendering. Extend with last-modified metadata per note.

## Impact

- **Frontend**: New `GraphPanel` component using a Canvas/WebGL graph library (recommended: `@react-force-graph-2d` -- React-native API, handles 1000+ nodes, ~50KB gzipped, good defaults). New toggle in BacklinksPanel. New full-screen view mode entry in the `view` state union.
- **Backend**: 1-2 new endpoints in `links.controller.ts`. One query joining `note_links` for edges, one aggregating `note_changes` for last-modified timestamps. No schema changes needed.
- **No DB migration**: All data already exists in `note_links` and `note_changes` tables. The graph endpoints are read-only aggregations.
- **Performance**: At 10s-100s of notes, trivial. At 1000+ notes, the full graph endpoint should be fine (single SQL query), but the frontend rendering is the bottleneck -- WebGL rendering (which `react-force-graph` uses via Canvas) handles this well. Local graph (depth-limited) stays fast regardless of vault size.
- **Bundle size**: `react-force-graph-2d` adds ~50KB gzipped. Acceptable given the feature value.

## Design Decisions

- **Broken links**: Shown as ghost nodes (dimmed, dashed outline) so users can spot dead links visually. Uses `targetPath: null` records from `note_links`.
- **Edge direction**: Directed edges with subtle, small arrows -- visible enough to convey direction without cluttering the view. Arrow size should feel proportional and refined, not dominant.
- **Live updates**: Debounced re-render, 2-3 seconds after the last link change. No jank while typing, graph stays current without manual refresh.
- **Two modes**: Right sidebar panel for focused local graph (daily tool), plus full-screen view for vault-wide exploration and gardening. Pop-out button in the panel transitions smoothly to full-screen, centered on the same note.

## Phasing

**V1 (local graph panel + full-screen)**: Backend graph endpoints (local with depth filter + full vault) + GraphPanel component in right sidebar + BacklinksPanel "List | Graph" toggle + full-screen view mode. Delivers both the daily-use tool and the exploration view.

**V2 (polish)**: Search/filter in global view, clustering for large vaults, keyboard navigation, and any UX refinements based on real usage.
