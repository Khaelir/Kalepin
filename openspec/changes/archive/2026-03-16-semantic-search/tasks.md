## 1. Dependencies & Model Setup

- [x] 1.1 Add `onnxruntime-node` and `@xenova/transformers` (or raw tokenizer) dependencies to `packages/backend/package.json`
- [x] 1.2 Download and bundle the all-MiniLM-L6-v2 ONNX model files (model.onnx, tokenizer.json, tokenizer_config.json) — set up a script or postinstall to fetch them
- [x] 1.3 Create an `EmbeddingService` class that loads the ONNX model on init and exposes an `embed(text: string): Promise<Float32Array>` method

## 2. Chunking

- [x] 2.1 Implement `chunkMarkdown(content: string, path: string)` — splits on heading boundaries, returns `{ text, heading, chunkIdx }[]`
- [x] 2.2 Add soft splitting for sections exceeding ~2000 chars: split on paragraph boundaries with ~100 char overlap
- [x] 2.3 Handle edge cases: notes without headings (single chunk), empty notes (skip)

## 3. Embedding Storage

- [x] 3.1 Create the `note_embeddings` table in `SearchService.onModuleInit()` — columns: `path TEXT, chunk_idx INTEGER, chunk_text TEXT, heading TEXT, embedding BLOB`
- [x] 3.2 Implement `indexNoteEmbeddings(path, content)` — chunk the note, embed each chunk, store in DB (delete-then-insert pattern)
- [x] 3.3 Implement `removeNoteEmbeddings(path)` — delete all embedding rows for a path

## 4. Vector Search

- [x] 4.1 Implement `vectorSearch(query: string, limit: number)` — embed the query, load all embeddings, compute cosine similarity, return top N results with `{ path, heading, chunkText, score }`
- [x] 4.2 Deduplicate vector results by path (keep the best-scoring chunk per note)

## 5. Hybrid Merge

- [x] 5.1 Implement `mergeResults(ftsResults, vectorResults)` using Reciprocal Rank Fusion (k=60)
- [x] 5.2 Update `search()` to run both FTS5 and vector search, merge with RRF, return unified results
- [x] 5.3 Ensure `search()` gracefully degrades if embeddings are not yet ready (return FTS5-only results)

## 6. Watcher & Reindex Integration

- [x] 6.1 Extend the file watcher hook in `onModuleInit` to call `indexNoteEmbeddings` on add/change and `removeNoteEmbeddings` on unlink
- [x] 6.2 Update `reindexAll()` to clear and regenerate both FTS5 index and embeddings
- [x] 6.3 On first startup with empty embeddings table, run full embedding indexing (can be background/async while FTS5 is already available)

## 7. Testing

- [x] 7.1 Test chunking: multi-heading note, long section splitting, no-heading note, empty note
- [x] 7.2 Test hybrid search: query with keyword matches only, semantic matches only, both, and deduplication
- [x] 7.3 Test watcher integration: add/change/delete a note triggers embedding update
