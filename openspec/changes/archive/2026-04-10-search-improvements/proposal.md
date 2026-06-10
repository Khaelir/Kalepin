## Why

Search works but leaves quality and performance on the table. FTS5 treats title and body matches equally, OR-mode queries return too much noise for multi-word searches, and the vector channel ignores file paths/names entirely — the most human-readable signal about what a note is about. Brute-force vector search re-loads all embeddings from SQLite and re-embeds every query from scratch, even single characters. Chunking is conservative (800 chars) relative to the E5-base model's 512-token capacity, and code blocks get split like prose.

These are all independent, low-risk improvements that compound into noticeably better ranking and responsiveness.

## What Changes

**FTS5 ranking**
- Add column weights to `bm25()`: title > path > content
- Default to AND-mode for multi-word queries, fall back to OR if too few results
- Support quoted phrase matching (pass-through to FTS5 phrase syntax)

**Vector search quality**
- Prepend humanized file path/name to the first chunk before embedding — captures the "about-ness" that filenames carry
- Skip vector search for queries shorter than 3 characters (FTS handles short prefixes better)
- Raise cosine similarity threshold from 0.3 to 0.4

**Vector search performance**
- LRU cache for query embeddings (avoid re-embedding repeated/refined queries)
- In-memory vector cache (keep all Float32Arrays in a Map, invalidate per-path on file watcher events, eliminate SQLite round-trip per search)

**Chunking**
- Increase MAX_CHUNK_CHARS from 800 to ~1200 to better use E5-base's 512-token window
- Code-block-aware splitting: treat fenced code blocks as atomic units, don't paragraph-split inside them

**RRF merge**
- Light recency boost: gently favor recently-modified notes when relevance scores are close

**Reindex**: chunking and embedding changes require a one-time full reindex.

## Capabilities

### New Capabilities

_(none — all changes improve existing capabilities)_

### Modified Capabilities

- `full-text-search`: Add column-weighted BM25, AND-default query mode, quoted phrase matching
- `semantic-search`: Path-aware embeddings, smarter chunking (larger chunks, code-block-aware), min query length gate, raised cosine threshold, query embedding cache, in-memory vector cache, recency boost in RRF merge

## Impact

- **Code**: `search.service.ts`, `chunk-markdown.ts`, `embedding.service.ts` (all in `packages/backend/src/search/`)
- **Data**: Requires full reindex after deployment (chunking + embedding changes). Existing `note_embeddings` rows become stale.
- **Memory**: In-memory vector cache adds ~30MB at 10k chunks (768 dims x 4 bytes x 10k). Query LRU is negligible.
- **API**: No endpoint changes. Same `GET /api/files/search?q=` contract, better results.
- **Dependencies**: None added or removed.
