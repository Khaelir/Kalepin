## 1. Backend — Graph endpoint

- [x] 1.1 Add `getGraphData(path?: string, depth?: number)` method to `LinkIndexService` — if path is provided, BFS from that note up to `depth` hops collecting nodes and edges; if no path, return all notes as nodes and all links as edges. Each node includes: path, title (derived from filename), inCount, outCount, lastModified (from `note_changes`). Include ghost nodes for broken links (`targetPath: null`).
- [x] 1.2 Add `GET /api/links/graph` endpoint to `LinksController` with optional `path` and `depth` query parameters. Guard with `CombinedAuthGuard` and `links:read` scope.

## 2. Frontend — API types and client

- [x] 2.1 Add `GraphNode` and `GraphEdge` interfaces to `api.ts`. `GraphNode`: `{ path: string; title: string; inCount: number; outCount: number; lastModified: string | null; isBroken?: boolean }`. `GraphEdge`: `{ source: string; target: string }`.
- [x] 2.2 Add `fetchGraph(path?: string, depth?: number)` function to `api.ts`.

## 3. Frontend — Graph library setup

- [x] 3.1 Install `react-force-graph-2d` in `packages/frontend`.

## 4. Frontend — Local graph panel

- [x] 4.1 Create `GraphPanel` component in `packages/frontend/src/components/GraphPanel.tsx`. Props: `activeFile`, `onNavigate`, `onPopOut`. Use `react-force-graph-2d` to render a force-directed graph.
- [x] 4.2 Implement node rendering with staleness coloring — map lastModified age to opacity (bright = recent, dim = stale). Ghost nodes get dashed outline and dimmed color.
- [x] 4.3 Implement click-to-navigate: `onNodeClick` calls `onNavigate(node.path)`. Animate graph re-centering on the new node.
- [x] 4.4 Implement hover behavior: show note title label on hover, always show label for current note. Show tooltip with title, inCount, outCount, and last-modified age.
- [x] 4.5 Render directed edges with subtle small arrows using `linkDirectionalArrowLength` and `linkDirectionalArrowRelPos`.
- [x] 4.6 Implement super-hub protection: if center note has 30+ connections, cap at 25 most relevant (sorted by recency + degree), show "+N more" text indicator.
- [x] 4.7 Add pop-out button that calls `onPopOut` to transition to full-screen graph view.

## 5. Frontend — BacklinksPanel toggle

- [x] 5.1 Add `displayMode` state (`'list' | 'graph'`) to `BacklinksPanel`. Add "List | Graph" toggle buttons in the panel header area.
- [x] 5.2 Conditionally render existing list view or `GraphPanel` based on `displayMode`. Pass `activeFile`, `onNavigate`, and `onPopOut` to `GraphPanel`.

## 6. Frontend — Full-screen graph view

- [x] 6.1 Add `'graph'` to the `view` state union type in `App.tsx`. Add rendering branch for `view === 'graph'` showing the `GraphView` component.
- [x] 6.2 Create `GraphView` component in `packages/frontend/src/components/GraphView.tsx`. Uses full vault graph data (no path filter). Includes back button to return to workspace.
- [x] 6.3 Implement orphan highlighting: nodes with zero inbound links get a hollow outline or distinct accent color.
- [x] 6.4 Implement node size by degree: `val` prop proportional to total link count (inCount + outCount).
- [x] 6.5 Implement click-to-navigate: clicking a node opens that note and switches `view` back to `'workspace'`.
- [x] 6.6 Wire pop-out button in `GraphPanel` to `setView('graph')` in `App.tsx`, passing the current note as the initial center.

## 7. Frontend — Styling

- [x] 7.1 Add CSS for graph toggle buttons, graph panel container, tooltip, "+N more" indicator, and pop-out button. Support both dark and light themes via CSS variables.

## 8. Frontend — Live updates

- [x] 8.1 Add debounced graph data re-fetch (2-3s) when the active file changes or a WebSocket `file-changed` event fires for any `.md` file.

## 9. E2E tests

- [x] 9.1 Create `packages/e2e/tests/graph-view.spec.ts`. Set up test notes with links between them using `createNote`.
- [x] 9.2 Test: open backlinks panel, verify list mode is default, toggle to graph mode, verify canvas element renders.
- [x] 9.3 Test: toggle back to list mode, verify backlinks list is visible again.
- [x] 9.4 Test: open full-screen graph view, verify the graph canvas renders and back button returns to workspace.
- [x] 9.5 Test: verify the graph API endpoint returns correct nodes and edges for linked test notes (API-level test via `page.request`).
