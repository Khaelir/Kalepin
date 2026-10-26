# Search Architecture

## Overview

Hybrid search combining **FTS5** (keyword matching, OR mode) and **vector similarity** (semantic matching), merged via **Reciprocal Rank Fusion** (RRF, K=20, vector weight=1.5x).

```
search(query)
  ├── ftsSearch(query)        → top 50 by BM25
  ├── vectorSearch(query)     → top 50 by cosine similarity
  └── mergeResults(fts, vec)  → RRF-ranked unified results
```

## Components

| File | Role |
|------|------|
| `search.service.ts` | FTS5 indexing, embedding storage, vector search, hybrid merge, watcher hooks |
| `embedding.service.ts` | Loads ONNX model via `@huggingface/transformers`, exposes `embed(text) → Float32Array` |
| `chunk-markdown.ts` | Splits markdown into chunks at heading boundaries for granular embedding |

## Embedding Model

**multilingual-e5-base** (quantized ONNX, ~278M params, 768-dim embeddings, 512 max tokens).

- Downloaded via `npm run download-model` → `packages/backend/models/` (gitignored)
- Loaded once on startup, kept in memory (~500-700MB RAM)
- Supports 100+ languages with cross-lingual semantic matching
- E5 models require `"query: "` / `"passage: "` prefixes (handled in `embedding.service.ts`)
- On startup, detects stale embeddings (wrong dimension) and triggers automatic re-indexing

## Chunking Strategy

1. Split on heading boundaries (`#` through `######`)
2. Tiny sections (<50 chars, e.g. heading-only) merge into the next section
3. Sections exceeding ~800 chars soft-split on paragraph boundaries with ~200 char overlap
4. Notes without headings → single chunk
5. Empty notes → skipped

## Vector Storage

Embeddings stored as raw `Float32Array` BLOBs in `note_embeddings` table:

```
note_embeddings(path, chunk_idx, chunk_text, heading, embedding)
```

Search is **brute-force**: load all embeddings, compute cosine similarity in JS, filter by threshold (cosine ≥ 0.3), return top N. No ANN index.

## Performance & Scaling

| Notes | Chunks (~4/note) | Search latency | Full reindex |
|-------|:-----------------:|:--------------:|:------------:|
| 100   | 400               | <5ms           | ~5s          |
| 1,000 | 4,000             | ~25ms          | ~1-2 min     |
| 2,500 | 10,000            | ~50ms          | ~3-5 min     |
| 5,000 | 20,000            | ~150ms         | ~8-15 min    |

**Upgrade path at ~2,500+ notes:** Replace brute-force with [sqlite-vec](https://github.com/asg017/sqlite-vec) ANN index. The data model doesn't change — just the query mechanism.

## Related Notes

`related-notes.service.ts` answers "which notes are about the same thing as this one?" (`GET /api/search/related`, MCP `related_notes`).

- A note's vector is the L2-normalised mean of its note-chunk embeddings (comment chunks excluded); related notes are ranked by the dot product of mean vectors, floor **0.88** (`RELATED_NOTES_MIN_SCORE`), top 5 by default (max 20). e5 passage similarities sit in a narrow band — see `openspec/changes/add-related-notes/design.md` for the calibration.
- Mean vectors are cached per path, built from the in-memory chunk cache and invalidated through `SearchService.onNoteEmbeddingsChanged` (fired by `embedNow`, `removeNoteEmbeddings`, `reindexAll`). A request is one pass over notes.
- Candidates pass the same visibility predicate as `vectorSearch` before scoring; `_secure/`, `_attachments/` and dot-folders are never returned. Each result carries the best-matching chunk pair as its "why" and a `linked` flag from the link index.

## Graceful Degradation

- If the ONNX model fails to load → `embeddingService.ready === false` → search returns FTS5-only results
- If embeddings table is empty on startup → background indexing runs while FTS5 search is already available
- Incremental updates via file watcher: single-note re-embedding takes <100ms
