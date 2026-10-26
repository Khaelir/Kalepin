# Tasks — add related notes

## 1. Calibration

- [x] 1.1 Embed a mixed EN/FR sample corpus with the real model through `EmbeddingService` (chunked and path-prefixed like `embedNow`), measure mean-vector cosines for related vs unrelated pairs, pick the floor, record the numbers in design.md.

## 2. SearchService hooks

- [x] 2.1 Export the chunk cache entry type; add `getNoteChunkVectors()` returning the lazily loaded chunk cache.
- [x] 2.2 Add `onNoteEmbeddingsChanged(listener)`; notify with the path from `embedNow` (after the chunk cache update) and `removeNoteEmbeddings`, and with `null` from `reindexAll`.
- [x] 2.3 `reindexAll` drops the in-memory chunk cache after clearing `note_embeddings`.

## 3. Link index

- [x] 3.1 `LinkIndexService.getLinkedPaths(path)` — resolved outgoing targets ∪ backlink sources.

## 4. Ranking service

- [x] 4.1 Pure helpers in `search/related-notes.ts`: `meanVector`, `cosine`, `bestChunkPair`, `excerptOf`, `isRelatedCandidatePath`, `clampRelatedLimit`, constants (default 5, max 20, floor 0.88, `RELATED_NOTES_MIN_SCORE` override).
- [x] 4.2 `RelatedNotesService.findRelated(path, { limit, userEmail })`: availability, source visibility (`assertReadableBy`), E2E source, candidate exclusions + visibility predicate before scoring, floor, top N, `linked`, best-chunk reason, `reason: null` for PIN-locked candidates.
- [x] 4.3 Mean-vector cache filled lazily from the chunk cache, invalidated through `onNoteEmbeddingsChanged`.
- [x] 4.4 `RelatedNotesController`: `GET /api/search/related` (`notes:search`), 400 without `path`, PIN gate via `assertUnlockedForRequest`.
- [x] 4.5 Register service + controller in `SearchModule`, export the service.

## 5. MCP

- [x] 5.1 `related_notes` read tool (`path` | `id`, `limit`), resolved via `resolveNoteRef`, PIN sentinel, E2E and unavailable text responses, ids via `findOrCreateForPaths`.
- [x] 5.2 Add to `REGISTERED_TOOLS`; inject `RelatedNotesService` as an optional trailing constructor argument.

## 6. Backend tests

- [x] 6.1 Helpers: mean vector normalisation, best chunk pair, excerpt, path exclusions, limit clamping, env floor override.
- [x] 6.2 Service with synthetic vectors on a real `SearchService` (in-memory SQLite, fake embedder): ranking order, floor, limit, self exclusion, `linked` both directions, reason headings, unavailable model, E2E source, note without embeddings.
- [x] 6.3 Gating: foreign personal source → 404; foreign personal candidates never returned; own personal and granted candidates returned; `_secure/`, `_attachments/` and dot-folder candidates excluded; PIN-locked candidate has `reason: null`.
- [x] 6.4 Cache invalidation: re-embed changes the ranking; watcher `unlink` (trash move) evicts; `reindexAll` clears.
- [x] 6.5 Controller: 400 without path, limit parsing, PIN 423.
- [x] 6.6 MCP: `related_notes` by id and by path, PIN sentinel, unavailable message; registration test passes.

## 7. Frontend

- [x] 7.1 `api.ts`: `RelatedNote` types + `fetchRelatedNotes(path, limit?)` appended at the end.
- [x] 7.2 Pure helpers `components/related-notes.ts`: folder label, reason label, wikilink target; vitest.
- [x] 7.3 `RelatedNotesSection`: fetch on note change, 50 s debounced refetch on revision change, stale-response guard, states (loading / empty / unavailable / encrypted / error), persisted open state, "not linked" chip, click + Enter navigation, optional Link action.
- [x] 7.4 `BacklinksPanel` renders the section (optional `revision`, `onInsertLink` props); `App.tsx` passes them.
- [x] 7.5 `EditorHandle.appendWikilink(path)` appends a wikilink paragraph when the editor is editable.
- [x] 7.6 Styles appended under `/* ── Related notes ── */` using `--kalepin-*` variables.

## 8. E2E

- [x] 8.1 `packages/e2e/tests/related-notes.spec.ts`: section renders; with the model loaded, a related note appears with the "not linked" chip and the unrelated one does not; Link inserts the wikilink; personal-folder isolation over the API; without the model, the unavailable state.
- [x] 8.2 Leak-token suite fixtures for `/api/search/related` and `related_notes`.

## 9. Verification

- [x] 9.1 `npx nest build` + new and neighbouring backend tests (search, links, mcp).
- [x] 9.2 Frontend `npx tsc -b` + `npx vitest run`.
- [x] 9.3 `openspec validate add-related-notes --strict`.
- [x] 9.4 Run `related-notes.spec.ts` (and the leak-token suite with `LEAK_TOKEN_SUITE_ENABLED=1`) after merge — not run in the feature worktree because the e2e suite uses fixed ports and data dir.
  Result on the merged branch: `related-notes.spec.ts` passes with the model loaded. The leak-token suite passes 6/7; the HTTP-route test reports 4 leaks via `/api/files/headings` and `/api/links/graph`, identical on unmodified main, so none come from this change.
