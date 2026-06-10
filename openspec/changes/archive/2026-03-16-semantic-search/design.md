## Context

Kalepin's `SearchService` provides FTS5-based full-text search over markdown notes stored on disk. The search is exposed via `/api/files/search` and consumed by the MCP server's `search_notes` tool. FTS5 uses BM25 ranking with prefix matching — effective for keyword queries but blind to semantic similarity.

The MCP server is used by LLMs, which phrase queries in natural language. A query for "project planning" should surface notes about "todos", "roadmap", or "milestones" even without keyword overlap.

## Goals / Non-Goals

**Goals:**
- Add semantic search capability using a local embedding model (no external API dependency)
- Combine FTS5 and vector results transparently in the existing `search()` method
- Keep embedding logic in application code for DB portability (PostgreSQL later)
- Reuse existing file watcher hooks for incremental re-embedding
- Keep the system simple — suitable for hundreds to low-thousands of notes

**Non-Goals:**
- Approximate Nearest Neighbor (ANN) indexes — brute-force cosine similarity is sufficient at this scale
- Exposing separate semantic vs keyword search endpoints
- Supporting multiple embedding models or model configuration
- GPU acceleration — CPU inference is fast enough for single-note re-embedding

## Decisions

### 1. Embedding model: all-MiniLM-L6-v2 via ONNX Runtime

**Choice:** Bundle `all-MiniLM-L6-v2` (22M params, ~80MB) and run it locally with `onnxruntime-node`.

**Why over alternatives:**
- **vs API-based (OpenAI, Voyage):** No network dependency, no cost, no data leaving device. Aligns with Kalepin's local-first nature.
- **vs larger local models:** MiniLM-L6 offers the best size/quality tradeoff for short text chunks. 384-dimensional embeddings are compact.
- **vs transformers.js:** onnxruntime-node has better Node.js performance and native bindings.

The model files ship as a package dependency (or downloaded on first run).

### 2. Vector storage: regular SQLite table with BLOB columns

**Choice:** Store vectors as Float32Array BLOBs in a standard SQLite table. Compute cosine similarity in JavaScript after loading candidates.

```
note_embeddings
├── path        TEXT     (note file path)
├── chunk_idx   INTEGER  (chunk position within note)
├── chunk_text  TEXT     (the chunked text, for snippet generation)
├── heading     TEXT     (nearest heading above chunk)
└── embedding   BLOB     (Float32Array, 384 dims = 1.5KB per chunk)
```

**Why over alternatives:**
- **vs sqlite-vec:** Avoids a native extension dependency. At <10k chunks, loading all vectors and computing cosine in JS takes <50ms. We can add sqlite-vec later if needed.
- **vs separate vector DB (Chroma, Qdrant):** Extra process, extra dependency. Overkill for this scale.
- **vs in-memory only:** Persisting to SQLite avoids re-embedding all notes on every restart.

### 3. Chunking: heading-based with soft token limit

**Strategy:**
1. Split note on heading boundaries (any `#` level)
2. Each heading section becomes a chunk, prefixed with its heading for context
3. If a section exceeds ~500 tokens (~2000 chars), split on paragraph boundaries (double newline) with ~100 char overlap
4. Short notes (<500 tokens total) become a single chunk
5. Each chunk carries metadata: `{ path, chunkIdx, heading }`

**Why:** Heading-based splits preserve semantic coherence better than fixed-size windows. The soft limit prevents very long sections from producing diluted embeddings.

### 4. Hybrid merge: Reciprocal Rank Fusion (RRF)

**Choice:** Merge FTS5 and vector results using RRF.

```
score(doc) = 1/(k + rank_fts) + 1/(k + rank_vec)
where k = 60 (standard constant)
```

**Why over alternatives:**
- **vs raw score normalization:** BM25 and cosine similarity are on different scales. Normalizing them requires tuning. RRF is rank-based and needs no tuning.
- **vs learned ranking:** Way too complex for this use case.

**Merge flow:**
1. Run FTS5 query → top 50 results ranked by BM25
2. Run vector query → top 50 chunks ranked by cosine similarity
3. Deduplicate by path (keep best chunk per path for vector results)
4. Compute RRF score per unique path
5. Return top 50 merged results

### 5. Integration point: extend SearchService

**Choice:** Add embedding methods directly to `SearchService` rather than creating a separate service.

**Why:** The search service already owns FTS5 indexing, the watcher hooks, and the `search()` method. Adding vector logic here keeps the hybrid merge simple and avoids circular dependencies.

**Modified flow in `onModuleInit`:**
1. Create FTS5 table (existing)
2. Create `note_embeddings` table (new)
3. Load ONNX model (new)
4. If embeddings table is empty, run full embedding indexing (new)
5. Hook file watcher — on change, update both FTS5 and embeddings (extended)

### 6. Model loading and lifecycle

**Choice:** Load the ONNX model once on module init, keep it in memory.

The model session (~80MB RAM) stays loaded for the process lifetime. This avoids cold-start latency on search queries. For a desktop/server app serving one user, this is acceptable.

## Risks / Trade-offs

- **First-run indexing time:** Embedding hundreds of notes on first start could take 30-60 seconds on CPU. → Mitigation: Index in background, FTS5 search works immediately. Log progress.
- **Memory usage:** ~80MB for the ONNX model + embeddings in memory during search. → Acceptable for a server-side app. Embeddings are only loaded during search, not kept in memory.
- **ONNX binary size:** `onnxruntime-node` adds ~50MB to node_modules. → Acceptable tradeoff for offline capability.
- **Chunk quality:** Heading-based chunking may produce poor chunks for notes without headings. → Mitigation: Fall back to paragraph-based splitting, or treat entire short note as one chunk.
- **Model download:** The ONNX model file (~80MB) needs to be available. → Ship as npm dependency or download on first run with clear progress indication.
