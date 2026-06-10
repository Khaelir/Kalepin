## Context

Kalepin's search is a hybrid FTS5 + vector pipeline in `packages/backend/src/search/`. FTS5 handles keyword matching (BM25), vector search handles semantic similarity (E5-base, 768-dim, brute-force cosine), and Reciprocal Rank Fusion merges both channels.

Current state:
- FTS5 indexes `(path, title, content)` but `bm25()` uses equal column weights
- FTS queries are OR-mode with prefix matching — high recall, low precision for multi-word queries
- Vector search embeds note body chunks only — file path and name are not embedded
- Chunking splits at 800 chars on paragraph boundaries, unaware of code fences
- Every search loads all embeddings from SQLite and re-embeds the query from scratch
- Cosine threshold is 0.3 (permissive — short docs produce noisy scores in the 0.3–0.45 range)
- No recency signal in ranking

## Goals / Non-Goals

**Goals:**
- Improve result ranking quality (title/path awareness, AND-default, phrase support)
- Reduce wasted compute (min query length, query cache, in-memory vectors)
- Better chunk quality (larger chunks for E5-base's 512-token window, code block preservation)
- Light recency bias to break ties in favor of recent work

**Non-Goals:**
- sqlite-vec ANN index (premature — brute-force is fine at current scale)
- Frontend search UI changes (backend-only improvements)
- New API endpoints or response schema changes
- Tag/frontmatter indexing (separate future work)
- GPU acceleration for embedding inference

## Decisions

### D1: FTS5 column weights — `bm25(notes_fts, 5.0, 10.0, 1.0)`

Column order in the FTS5 table is `(path, title, content)`. Weight the title 10x and path 5x relative to content. A title match is the strongest keyword signal; a path match (folder structure, filename) is weaker than title but stronger than a random body mention.

**Alternative considered:** Separate FTS5 tables for title-only search — rejected as unnecessarily complex. BM25 column weights are the standard FTS5 mechanism for this.

### D2: AND-default with OR-fallback for FTS queries

```
1. Build AND query: "term1"* AND "term2"* ...
2. Execute; if results >= 3, use them
3. Else fall back to OR query: "term1"* OR "term2"*
```

Threshold of 3 results (not 0) avoids the case where AND returns a single marginal match while OR would surface several good ones. Single-word queries are unaffected (AND and OR are equivalent).

**Alternative considered:** Always AND — rejected because FTS5 prefix matching can miss valid results when terms don't co-occur literally (that's what vector search is for). The OR fallback preserves recall.

### D3: Quoted phrase pass-through

Detect substrings wrapped in `"..."` in the user's query and pass them as FTS5 phrase queries. Non-quoted terms remain prefix-matched.

Input: `"error handling" react` → FTS5: `"error handling" AND "react"*`

Simple regex extraction. No new syntax beyond what users already expect from search boxes.

### D4: Prepend humanized path to first chunk

Before embedding, prepend a cleaned-up version of the file path to the first chunk's text:

```
"recipes/thai green curry — " + chunk.text
```

Transformation: strip `.md` extension, replace `/` and `-` with spaces for inner path segments, keep the last segment (filename) most prominent. Only the first chunk gets the prefix — subsequent chunks in the same note already have heading context.

This does NOT change what's stored in `chunk_text` in the database — the prefix is applied at embedding time only, so snippets remain clean.

**Alternative considered:** Embed the path as a separate chunk — rejected because it would add one extra embedding per note and complicate deduplication. Prepending to the first chunk is simpler and captures the same signal.

### D5: Min query length gate for vector search

Skip vector search entirely when the query is fewer than 3 characters. Return FTS-only results. Short queries like "k" or "go" produce near-meaningless embeddings — FTS prefix matching is strictly better for these.

Implemented as an early return in `search()`, before calling `vectorSearch()`.

### D6: Raise cosine threshold to 0.4

The current 0.3 threshold lets through weakly-related results that add RRF noise. E5-base with normalized embeddings produces genuine matches above 0.45 typically. Raising to 0.4 trims the noise tail without cutting real matches.

This pairs with D4 (path-aware embeddings) — once filenames contribute to embeddings, the score distribution shifts upward for relevant results, making 0.4 a comfortable cutoff.

### D7: Query embedding LRU cache

Cache the last 50 query embeddings keyed by the raw query string. On cache hit, skip the E5 model entirely (saves 50–200ms). Entries never need invalidation — the same query always produces the same embedding.

Use a simple Map with insertion-order tracking. 50 entries × 768 dims × 4 bytes = ~150KB — negligible.

### D8: In-memory vector cache

On first search (or startup), load all embeddings into a `Map<string, { path, heading, chunkText, embedding: Float32Array, source }[]>` keyed by path. Subsequent searches score directly from memory — no SQLite I/O.

Invalidation: on file watcher events, delete the path's entry from the Map. The next `indexNoteEmbeddings()` call inserts new embeddings into SQLite, and we reload that path's entries into the Map.

Memory: ~30MB at 10k chunks (768 × 4 bytes × 10k + string overhead). Acceptable for a server process already holding the E5 model in memory (~500–700MB).

**Alternative considered:** Pre-load on startup — rejected because it blocks module init. Lazy-load on first search is simpler and the one-time cost is ~25ms.

### D9: Increase MAX_CHUNK_CHARS to 1200

E5-base handles 512 tokens (~2000–2500 chars of English). The current 800-char soft limit is conservative — it produces more chunks than necessary, splitting coherent passages. Raising to 1200 keeps chunks within the model's sweet spot while reducing total chunk count by ~30%, which also speeds up brute-force scoring.

OVERLAP_CHARS stays at 200 — proportionally smaller relative to chunk size, which is fine.

### D10: Code-block-aware chunking

Treat fenced code blocks (` ``` `) as atomic units in `softSplit()`. When accumulating paragraphs, if a paragraph is inside a code fence, do not split before it — let the chunk grow beyond MAX_CHUNK_CHARS rather than breaking a code block. After the fence closes, resume normal splitting.

Implementation: in `softSplit()`, track whether we're inside a fence. When inside, always append to current chunk regardless of size. This may produce occasional oversized chunks for very long code blocks, but E5-base truncates gracefully at 512 tokens — the beginning of the code (imports, function signature) is usually the most semantically useful part anyway.

### D11: Light recency boost in RRF merge

After computing RRF scores, apply a small multiplicative boost based on file modification time:

```
boost = 1 + 0.1 * exp(-daysSinceModified / 90)
finalScore = rrfScore * boost
```

- Edited today: +10%
- Edited last week: ~+9%
- Edited 3 months ago: ~+4%
- Edited 1 year ago: ~+1%

This requires passing modification timestamps through to `mergeResults()`. The file watcher already tracks this; for files not recently changed, read `mtime` from the filesystem during search (cached in the in-memory vector cache from D8).

**Alternative considered:** Boost in the FTS or vector channel independently — rejected because recency should influence final ranking, not individual channel scores. Applying it in the merge keeps the FTS and vector channels pure relevance signals.

## Risks / Trade-offs

**[Reindex required]** → Chunking and embedding changes (D4, D9, D10) invalidate existing embeddings. Mitigation: the existing dimension-check auto-reindex mechanism can be extended to detect stale embeddings (e.g., a version marker in a metadata table). Reindex runs in background; FTS search remains available immediately.

**[Cosine threshold too aggressive]** → Raising from 0.3 to 0.4 might cut some legitimate matches for very short or very generic notes. Mitigation: FTS catches keyword matches regardless. Monitor vector result counts after deployment — if they drop dramatically, lower to 0.35.

**[In-memory cache memory growth]** → At 10k chunks the cache is ~30MB. At 50k chunks it would be ~150MB. Mitigation: this is a personal/small-team app — 50k chunks (~12,500 notes) is far beyond realistic usage. If it ever matters, sqlite-vec would replace brute-force entirely.

**[AND-default may feel restrictive]** → Users accustomed to OR-mode may notice fewer results for some queries. Mitigation: the fallback to OR when AND returns < 3 results handles sparse-match cases. Vector search also fills in semantic matches that AND-mode FTS misses.

**[Code block chunks may exceed token limit]** → A 200-line code block produces a chunk that E5-base truncates. Mitigation: truncation is graceful (model embeds the first 512 tokens). The function signature and top-level structure — the most useful parts — are at the beginning.

## Open Questions

- Should the recency boost use file mtime directly, or should we track a "last meaningful edit" timestamp that ignores whitespace-only changes? (Leaning toward mtime for simplicity.)
- Is the AND fallback threshold of 3 results right, or should it be tunable? (Start with 3, adjust based on feel.)
