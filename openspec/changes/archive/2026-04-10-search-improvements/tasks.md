## 1. FTS5 Ranking Improvements

- [x] 1.1 Add column weights to `bm25()` call in `ftsSearch()`: change `bm25(notes_fts)` to `bm25(notes_fts, 5.0, 10.0, 1.0)` for path/title/content weighting
- [x] 1.2 Implement AND-default query building: build AND query first, execute, fall back to OR if < 3 results
- [x] 1.3 Add quoted phrase detection: extract `"..."` substrings from query, pass as FTS5 phrase terms, prefix-match remaining terms
- [x] 1.4 Add tests for column-weighted ranking (title match > path match > body match)
- [x] 1.5 Add tests for AND/OR fallback behavior and phrase matching

## 2. Chunking Improvements

- [x] 2.1 Increase `MAX_CHUNK_CHARS` from 800 to 1200 in `chunk-markdown.ts`
- [x] 2.2 Add code-fence tracking to `softSplit()`: detect ``` boundaries, never split inside a fenced block
- [x] 2.3 Add path prefix to first chunk: humanize file path (strip .md, replace `-`/`_` with spaces) and prepend to first chunk text at embedding time (not in stored `chunk_text`)
- [x] 2.4 Update `chunkMarkdown` signature to use the `path` parameter (currently `_path`, unused)
- [x] 2.5 Add tests for code-block-aware chunking (single code block preserved, multiple blocks in one section, code block exceeding limit)
- [x] 2.6 Add tests for path prefix generation (nested paths, special characters, root-level files)

## 3. Vector Search Performance

- [x] 3.1 Implement query embedding LRU cache in `search.service.ts`: Map with 50-entry cap, keyed by raw query string
- [x] 3.2 Implement in-memory vector cache: lazy-load all embeddings into a Map on first `vectorSearch()` call
- [x] 3.3 Wire up cache invalidation: on `indexNoteEmbeddings()` and `removeNoteEmbeddings()`, update/delete the in-memory cache entry for that path
- [x] 3.4 Add tests for query cache (hit, miss, eviction)
- [x] 3.5 Add tests for in-memory vector cache (lazy load, invalidation on change, invalidation on delete)

## 4. Vector Search Quality

- [x] 4.1 Add minimum query length gate in `search()`: skip `vectorSearch()` when query is < 3 characters, return FTS-only results
- [x] 4.2 Raise `VECTOR_COSINE_THRESHOLD` from 0.3 to 0.4
- [x] 4.3 Add test for min-length gate (1-char and 2-char queries skip vector, 3-char queries use vector)

## 5. Recency Boost

- [x] 5.1 Pass file modification timestamps into `mergeResults()` — read mtime from filesystem or cache it alongside embeddings in the in-memory vector cache
- [x] 5.2 Apply recency boost formula after RRF scoring: `finalScore = rrfScore * (1 + 0.1 * exp(-daysSinceModified / 90))`
- [x] 5.3 Add tests for recency boost (recent note wins tie, old note still wins when relevance is clearly higher)

## 6. Reindex & Validation

- [x] 6.1 Trigger auto-reindex on deployment: extend the existing dimension-check mechanism to also detect stale embeddings (e.g., store a schema version in a metadata row)
- [ ] 6.2 Verify full reindex completes successfully with new chunking (larger chunks, code blocks, path prefix) *(manual — requires deployment)*
- [ ] 6.3 Manual QA: run representative queries and verify improved ranking vs. current behavior *(manual — requires deployment)*
