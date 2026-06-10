## Context

The backlinks feature already indexes all inter-note links in the `note_links` SQLite table and surfaces them as flat lists in the right sidebar (`BacklinksPanel`). The `note_changes` table tracks modification history per note. Together, these provide all the data needed for a graph visualization — nodes are notes, edges are links, and staleness comes from change timestamps.

The right sidebar supports three panel modes (`comments`, `backlinks`, `history`) toggled via buttons in the editor header. Full-screen views (`settings`, `changes`) replace the editor area and follow a consistent back-navigation pattern. The frontend uses React hooks for state management with no external state library.

## Goals / Non-Goals

**Goals:**
- Visualize note connections as an interactive force-directed graph
- Provide a local graph (current note + N-hop neighborhood) in the right sidebar for daily use
- Provide a full-screen global graph for vault-wide exploration and "gardening"
- Click-to-navigate between notes from the graph
- Surface visual signals: staleness (edit recency), orphans (zero inbound links), broken links (ghost nodes)
- Live updates when links change

**Non-Goals:**
- Clustering or community detection (V2 polish)
- Search/filter within the global graph (V2 polish)
- Keyboard navigation within the graph
- 3D graph visualization
- Edge labels or visual differentiation by link type (wikilink vs markdown)

## Decisions

### D1: Use `react-force-graph-2d` for rendering

**Choice:** Use `react-force-graph-2d` (~50KB gzipped) for both the sidebar panel and full-screen views.

**Alternatives considered:**
- **D3 force-simulation**: Low-level, requires significant boilerplate for Canvas rendering, zoom/pan, and interaction handlers.
- **Cytoscape.js**: Heavier bundle, jQuery-style API that doesn't integrate naturally with React.
- **Sigma.js**: WebGL-only, less React integration, more complex setup.

**Rationale:** React-native API, Canvas rendering handles 1000+ nodes efficiently, good defaults for force simulation, active maintenance. Same library for both local and global views avoids inconsistency.

### D2: Single graph API endpoint with optional depth filter

**Choice:** `GET /api/links/graph?path=X&depth=N` returns the subgraph within N hops of a note. Without params, returns the full vault graph.

**Alternatives considered:**
- **Separate endpoints for local vs global**: More REST-pure, but the logic is the same BFS with different parameters.
- **Client-side graph construction from backlinks/outgoing**: Requires multiple round trips and doesn't efficiently support multi-hop neighborhoods.

**Rationale:** Single endpoint simplifies the API. Server-side BFS is more efficient than multiple client round trips. The depth filter naturally degrades to "full vault" when omitted.

### D3: Graph as a display mode within BacklinksPanel

**Choice:** Add a "List | Graph" toggle to the BacklinksPanel header. When "Graph" is selected, render the local graph visualization instead of the backlinks/outgoing/mentions lists.

**Alternatives considered:**
- **Separate right panel type (`rightPanel === 'graph'`)**: Adds toolbar clutter with another header button.
- **Embed graph as a fourth collapsible section**: Fights for vertical space with three existing sections.

**Rationale:** Discovery is immediate — users already know where backlinks live. The toggle pattern is intuitive and keeps the toolbar clean. List view remains available for its unique value (context snippets, unlinked mentions, link conversion).

### D4: Full-screen graph as a new view mode

**Choice:** Add `'graph'` to the `view` state union alongside `'workspace'`, `'settings'`, `'changes'`. Full-screen graph replaces the editor area, accessed via a pop-out button in the local graph panel.

**Alternatives considered:**
- **Modal overlay**: Can't provide enough space for a vault-wide graph.
- **New browser tab/window**: Breaks the single-page app model.

**Rationale:** Consistent with existing full-screen views (Settings, Changes). The graph needs full viewport space for vault-wide exploration. Pop-out from the local graph provides a natural entry point.

### D5: Staleness via `note_changes` table

**Choice:** Join with `note_changes` to get `MAX(createdAt)` per path. Map age to node opacity — recently edited notes are bright, stale ones fade.

**Alternatives considered:**
- **File system mtime via storage adapter**: Requires per-file async calls, doesn't account for which changes were meaningful.
- **Store mtime on note_links**: Denormalizes data that already exists in note_changes.

**Rationale:** `note_changes` already tracks all modifications. A single SQL `GROUP BY` is efficient and avoids N+1 queries.

### D6: Ghost nodes for broken links

**Choice:** Links with `targetPath: null` appear as ghost nodes — dimmed, dashed outline. They are visible but clearly distinct from real notes.

**Alternatives considered:**
- **Hide broken links entirely**: Loses the opportunity to help users discover dead links.
- **Red warning nodes**: Too visually aggressive for what may be intentional (e.g., planned future notes).

**Rationale:** Ghost treatment surfaces the information without alarm. Users can spot and fix dead links naturally.

### D7: Super-hub cap at 25 visible neighbors

**Choice:** In the local graph, if the center note has 30+ connections, cap visible nodes at 25 (ranked by recency + link count) with a "+N more" indicator.

**Alternatives considered:**
- **Show all nodes**: Clutters the 300px panel, makes the graph illegible.
- **Progressive disclosure (click to expand)**: Adds interaction complexity for an edge case.

**Rationale:** 25 nodes keeps the panel usable. Ranking by recency + degree surfaces the most relevant connections. The indicator tells users there's more.

## Risks / Trade-offs

- **[Canvas testing in e2e]** → `react-force-graph-2d` renders on Canvas, so individual nodes can't be inspected via DOM selectors. → Mitigation: e2e tests verify the Canvas element renders and test toggle/navigation behavior via DOM. Node interaction testing relies on the library's API.

- **[Bundle size]** → `react-force-graph-2d` adds ~50KB gzipped. → Acceptable given the feature value. Lazy-load the graph component so it doesn't affect initial page load.

- **[Performance on large vaults]** → The full vault graph endpoint returns all nodes and edges. For 5000+ notes this could be a large payload. → Mitigation: the SQL query is fast (single join); Canvas rendering via WebGL handles thousands of nodes. If needed later, add pagination or server-side filtering.

- **[Graph layout instability]** → Force-directed layouts are non-deterministic — the graph may look different each time. → Accepted trade-off. The force simulation converges quickly and users can drag nodes to rearrange. Consistent center-on-current-note helps orientation.
