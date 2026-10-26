# Design — related notes

## Goal

For the open note, list the notes most semantically similar to it, say why, and flag the ones that are not linked yet. Reuse the embeddings search already maintains; add no new model, table or background job.

## Where it lives

`RelatedNotesService` and `RelatedNotesController` sit in `SearchModule` (`search/related-notes.*`), next to the embeddings they read. The endpoint is `GET /api/search/related?path=…&limit=…` under the `notes:search` scope rather than under `/api/links`: the ranking is an embedding query, the links controller is about the link graph, and `/api/search*` is already swept by the leak-token suite.

`search.service.ts` only gets hooks (another change is adding a `tag:` filter there):

```ts
export interface CachedEmbedding { … }                    // was module-private
async getNoteChunkVectors(): Promise<ReadonlyMap<string, readonly CachedEmbedding[]>>
onNoteEmbeddingsChanged(listener: (path: string | null) => void): void
```

Pure helpers (mean vector, cosine, best chunk pair, excerpt, path exclusions, limit clamping) live in `search/related-notes.ts` so the ranking is unit-testable without Nest or SQLite.

## Note vector

A note's vector is the L2-normalised mean of its `source = 'note'` chunk embeddings. Comment embeddings share the table and the chunk cache but are excluded: they are not the note's content and their count varies independently of it. Chunk 0's stored embedding includes the humanised path prefix (`"engineering deployment runbook — …"`, see `semantic-search`); we keep it, which nudges notes in the same folder together — in line with how people file related notes.

With normalised means, cosine similarity is a dot product, so a request is one pass of N dot products over 768 dimensions (≈2 M multiply-adds at 2,500 notes, a few ms in JS).

## Mean-vector cache

`RelatedNotesService` keeps `Map<path, Float32Array>`. It is filled lazily during a request from `SearchService`'s in-memory chunk cache (the `Float32Array`s are shared, not copied; the means add 3 KB per note). Entries are invalidated by the `onNoteEmbeddingsChanged` listener:

| Fired from | Covers |
|---|---|
| `embedNow(path)` (after the chunk cache is updated) | add / change via watcher, internal writes, OT-deferred flushes, MCP writes, reindex |
| `removeNoteEmbeddings(path)` | watcher `unlink` (deletes, renames, and moves into the `.trash/` dot-folder that the watcher then ignores), heal-sweep removals, E2E purges |
| `reindexAll()` → `null` | clears everything |

`reindexAll` now also sets the chunk cache to `null` after `DELETE FROM note_embeddings`. Before, entries for notes deleted from disk while the server was down survived a reindex in memory (the cache is only ever patched per path) and could resurface in vector search; for related notes they would be ghost results.

The scoring loop runs synchronously after the single `await` that fetches the chunk cache, so a mean is always computed from the chunk entries current at that moment, and any later write invalidates it.

## Ranking

```
findRelated(source, { limit, userEmail })
  model not ready                         → { available: false, items: [] }
  assertReadableBy(source, userEmail)     → 404 otherwise
  source is E2E (_secure)                 → { available: false, items: [] }
  source has no note chunks yet           → { available: true, items: [] }
  for each path in chunk cache:
    skip self, _attachments/, any dot-segment, !shouldIndexPlaintext(path)
    skip unless isVisibleTo(path, email) || grants.has(path)      ← before scoring
    score = dot(mean(source), mean(path))
    keep if score ≥ minScore
  sort desc, take limit
  linked = linkIndex.getLinkedPaths(source)    (outgoing targets ∪ backlink sources)
  reason = best chunk pair (max cosine over source chunks × candidate chunks)
```

The visibility predicate is the one `vectorSearch` uses, applied before any score is computed so non-visible notes never enter the ordering. `getLinkedPaths` is not visibility-filtered itself: it is only used to flag candidates that already passed the predicate.

`limit` defaults to 5; values above 20 clamp to 20, non-numeric or < 1 fall back to the default.

## Threshold calibration

Search's fixed 0.3/0.4 floor is meaningless here: e5 passage–passage cosines sit in a narrow, high band. Calibrated with the real model (`multilingual-e5-base`, q8 ONNX, loaded through `EmbeddingService`, chunked and path-prefixed exactly like `embedNow`) on an 18-note corpus: 5 ops/engineering notes + 1 French meeting note about the same incident, 3 recipes, 2 travel notes (EN + FR), 3 product/marketing notes, and 4 standalone notes (book notes, garden, a one-line "call the plumber", household budget). Pairs within a topic group are "related"; everything else, including every pair with a standalone note, is "unrelated".

| Mean-vector cosine | min | p10 | median | p90 | max |
|---|---|---|---|---|---|
| related (22 pairs) | 0.871 | 0.886 | 0.909 | 0.926 | 0.952 |
| unrelated (131 pairs) | 0.815 | 0.840 | 0.861 | 0.892 | 0.909 |

Floors over ordered (source → candidate) pairs, 44 related / 262 unrelated:

| Floor | related kept (recall) | unrelated kept | precision |
|---|---|---|---|
| 0.86 | 44 (1.00) | 142 | 0.24 |
| 0.87 | 44 (1.00) | 82 | 0.35 |
| **0.88** | **42 (0.95)** | **56** | **0.43** |
| 0.885 | 40 (0.91) | 46 | 0.47 |
| 0.89 | 34 (0.77) | 28 | 0.55 |
| 0.90 | 30 (0.68) | 8 | 0.79 |

**Chosen floor: 0.88.** It is the knee: it drops 79% of unrelated pairs — everything clearly off-topic (recipes ↔ ops runbooks, the plumber note ↔ anything, whose best neighbour is 0.876, so that note shows the empty state) — while keeping 95% of related pairs. The only related pair lost is the cross-lingual travel pair (Japan ↔ Bretagne, 0.871). Above 0.885 recall falls fast (cross-lingual and "same domain, different subsystem" pairs such as Postgres backups ↔ the French incident meeting at 0.881). What survives between 0.88 and 0.91 is loosely related (pricing page ↔ book on decision biases 0.909, budget ↔ marketing plan 0.904); ranking and the top-N cap put real neighbours first, and the "why" line lets the reader judge.

Also tried and rejected: centring vectors on the corpus centroid (precision 0.71 at recall 0.77, but unstable on small vaults where the centroid is the vault), and a per-source z-score cut (precision 0.65 at recall 0.73 for z ≥ 1, and it never yields an empty list, even for the standalone notes).

The floor is a constant (`RELATED_MIN_SCORE = 0.88`) overridable per deployment with `RELATED_NOTES_MIN_SCORE`, since the band shifts with a vault's language mix and topical spread. The calibration script was a one-off and is not part of the change.

## The "why"

For each returned note, all source-chunk × candidate-chunk cosines are computed (≤ 20 candidates × a handful of chunks each, negligible) and the best pair wins. The response carries:

```ts
reason: { heading: string; sourceHeading: string; excerpt: string } | null
```

`heading` is the matching section of the related note, `sourceHeading` the matching section of the open note, `excerpt` ≈160 characters of the related chunk with heading lines and inline markdown noise stripped. The UI renders `§ heading — excerpt`. `reason` is `null` when the related note is PIN-locked (its excerpt would bypass the PIN).

## Gates

- **Source visibility.** `GrantAwareVisibility.assertReadableBy` inside the service, so REST and MCP share it; unknown and foreign paths both 404 (no existence oracle).
- **Source PIN.** REST: `PinService.assertUnlockedForRequest` (423, same as `/api/files/read`; the open note's unlock cookie rides along). MCP: `pinReadSentinel`, like `read_note`. A related list describes the note's topic, so it is gated like a read.
- **Candidate PIN.** Listed (path and title are visible in the tree anyway) with `reason: null`.
- **E2E.** Source under `_users/{email}/_secure/` → `available: false`. Candidates under `_secure/` are skipped (they have no embeddings anyway; the check is defensive). The frontend does not call the endpoint for E2E notes.

## REST shape

```ts
GET /api/search/related?path=Notes/a.md&limit=5
→ {
    available: boolean,
    items: Array<{
      path: string,
      title: string,          // basename without .md
      score: number,          // mean-vector cosine
      linked: boolean,
      reason: { heading, sourceHeading, excerpt } | null
    }>
  }
```

400 when `path` is missing, 404 when not readable, 423 when PIN-locked.

## MCP tool

`related_notes` — registered for every scope, like the other read tools. Input `{ path?, id?, limit? }`, resolved with `resolveNoteRef` (so `id` wins, fuzzy paths and the "multiple matches" listing behave as in `read_note`). Output is a JSON array of `{ path, id, title, score, linked, reason }` with `score` rounded to 3 decimals; ids come from `docHandles.findOrCreateForPaths`, like `search_notes`. Unavailable and E2E cases return a plain-text explanation; PIN-locked sources return the `pin-protected` sentinel.

The requirement lives in the `related-notes` capability rather than as a MODIFIED delta of `mcp-tool-registration`, because other changes in flight also add tools and a full-text MODIFIED block per change would make them overwrite each other at archive time. `McpService` takes the new service as an `@Optional()` constructor argument appended after the existing optional ones, so positional constructions in tests keep working.

## UI

A fourth `<details>` section, "Related", at the bottom of the Backlinks panel's list mode:

- Row: title, folder (`prettifyPath` of the parent, so personal notes show `/alice@…/Projects`), a "not linked" chip when `linked` is false, and the "why" line. Click (or Enter) opens the note.
- **Link** button on unlinked rows when the open note is editable: calls `EditorHandle.appendWikilink(path)`, which appends a paragraph containing a wikilink node through a normal ProseMirror transaction (the OT bridge saves it like any edit). The target is the basename, unless the basename would resolve to a different note (frontend `resolveWikilink`, a port of the backend's), in which case it is the path without `.md`. The row flips to linked optimistically.
- Open by default; open/closed persisted per viewer in `localStorage` (`kalepin.related.open`, try/catch) because the panel remounts its sections on every note switch.
- States: loading, empty ("No related notes found"), unavailable ("Related notes need the semantic index, which isn't available right now."), encrypted note ("Not available for encrypted notes."), error.
- Refetch: immediately when the active note changes; after edits, 50 s after the last revision change. Embeddings for a note with an open OT session are deferred until 45 s of inactivity (`EMBEDDING_INACTIVITY_MS`), so refetching sooner would return the pre-edit ranking.

## Out of scope

- An ANN index. The brute-force pass is the same order of cost as one vector search; the `sqlite-vec` upgrade path in `ARCHITECTURE.md` applies to both.
- Related notes for E2E notes (the server has no plaintext; a client-side model is a separate project).
- Showing related notes in the graph view.
