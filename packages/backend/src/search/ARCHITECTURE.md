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

## Graceful Degradation

- If the ONNX model fails to load → `embeddingService.ready === false` → search returns FTS5-only results
- If embeddings table is empty on startup → background indexing runs while FTS5 search is already available
- Incremental updates via file watcher: single-note re-embedding takes <100ms
