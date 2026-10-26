# Related notes: semantic neighbours of the open note

## Why

Every note is already chunked and embedded with multilingual-e5-base for search, but the vectors are only ever compared against a typed query. The most useful connections in a vault are often between notes that never link to each other: a meeting note and the runbook it should have referenced, a French write-up and its English twin. Backlinks and unlinked mentions only find connections that already share a link or the exact note title.

The embeddings make "which notes are about the same thing as this one?" a cheap question: one pass over per-note vectors. Surfacing the answer next to backlinks, and flagging the ones that are not linked yet, turns the index into a linking aid. Agents get the same signal through MCP.

## What Changes

- **New ranking service.** `RelatedNotesService` compares the open note's vector (L2-normalised mean of its chunk embeddings) against every other note's mean vector, keeps scores at or above a calibrated floor (0.88, env-overridable), and returns the top N (default 5, max 20). Per-note mean vectors live in an in-memory cache built from the existing chunk cache and invalidated wherever embeddings are written or deleted.
- **A "why" per result.** Each result names the best-matching chunk pair: the related note's section heading, the open note's section heading and a short excerpt, plus the score and `linked` (true if either note already links to the other, per the link index).
- **Same gates as search.** The source note must be readable by the caller. Candidates go through the predicate `vectorSearch` uses (shared vault, own personal folder, active grants) before they are scored. `_secure/` paths, attachments and dot-folders (e.g. `.trash/`) never appear. PIN-locked source notes are gated like a read; PIN-locked candidates are listed without an excerpt.
- **Graceful when the model is missing.** If the embedding model is not loaded, or the source note is end-to-end encrypted, the answer is `{ available: false, items: [] }`, never an error.
- **REST.** `GET /api/search/related?path=…&limit=…` (`notes:search` scope).
- **MCP.** New read tool `related_notes` accepting `path` or `id` like the other note tools, returning `path`, `id`, `title`, `score`, `linked`, `reason`.
- **UI.** A collapsible "Related" section at the bottom of the right rail's Backlinks panel: title, folder, the "why" line, a subtle "not linked" chip, and a "Link" action that appends `[[Note]]` to the open note through the editor. Refetches when the active note changes and, debounced, after edits (embeddings update asynchronously). Empty and unavailable states.
- **Cache hygiene in `SearchService`.** A listener hook (`onNoteEmbeddingsChanged`) fires from `embedNow`, `removeNoteEmbeddings` and `reindexAll`; `reindexAll` now also drops the in-memory chunk cache so notes deleted between reindexes stop haunting vector results.

## Capabilities

### New Capabilities

- `related-notes`: per-note semantic neighbours — ranking, threshold, exclusions and visibility, mean-vector cache, the REST endpoint and the `related_notes` MCP tool.

### Modified Capabilities

- `backlinks-ui`: the Backlinks panel gains a "Related" section (added requirement; existing requirements unchanged).

## Impact

- **Backend**
  - `packages/backend/src/search/related-notes.ts` (new) — pure ranking helpers (mean vector, best chunk pair, excerpt, path exclusions, limit clamping).
  - `packages/backend/src/search/related-notes.service.ts` (new) — `RelatedNotesService.findRelated(path, { limit, userEmail })`, mean-vector cache.
  - `packages/backend/src/search/related-notes.controller.ts` (new) — `GET /api/search/related`.
  - `packages/backend/src/search/search.module.ts` — registers the service and controller, exports the service.
  - `packages/backend/src/search/search.service.ts` — small hooks only: exported chunk type, `getNoteChunkVectors()`, `onNoteEmbeddingsChanged()`, notifications in `embedNow` / `removeNoteEmbeddings` / `reindexAll`.
  - `packages/backend/src/links/link-index.service.ts` — `getLinkedPaths(path)`.
  - `packages/backend/src/mcp/mcp.service.ts` — `related_notes` tool, `REGISTERED_TOOLS` entry, optional constructor dependency appended last.
- **Frontend**
  - `packages/frontend/src/components/RelatedNotesSection.tsx` (new), `packages/frontend/src/components/related-notes.ts` (new, pure helpers).
  - `packages/frontend/src/components/BacklinksPanel.tsx` — renders the section; two optional props.
  - `packages/frontend/src/editor/Editor.tsx` — `appendWikilink(path)` on the imperative handle.
  - `packages/frontend/src/App.tsx` — passes `revision` and `onInsertLink` to `BacklinksPanel`.
  - `packages/frontend/src/api.ts` — `fetchRelatedNotes` appended; `styles.css` — one appended block.
- **E2E** — `packages/e2e/tests/related-notes.spec.ts` (new); the leak-token suite gets fixtures for the new route and tool.
- **Risk**
  - e5 similarities sit in a narrow band (unrelated notes score 0.82–0.91, related 0.87–0.95 on the calibration corpus), so any fixed floor lets some loosely related notes through. Results are capped at N and ranked, and the "why" line lets users judge; the floor can be tuned per deployment with `RELATED_NOTES_MIN_SCORE`.
  - Memory: one extra 3 KB vector per note (≈7.5 MB at 2,500 notes). The chunk vectors themselves are shared with search, not copied.
