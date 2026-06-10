## Why

The MCP server's `search_notes` tool uses FTS5 for full-text search, which only matches exact words (with prefix support). When an LLM searches for "task management" but notes use "todo" or "kanban", nothing is found. Semantic search bridges this gap by matching on meaning, not just keywords.

## What Changes

- Add a local embedding model (all-MiniLM-L6-v2 via ONNX Runtime) to generate vector embeddings for note chunks
- Store embeddings in SQLite alongside the existing FTS5 index
- Chunk notes by heading boundaries with soft splits at ~500 tokens for granular matching
- Make `search_notes` transparently combine FTS5 and vector search results using Reciprocal Rank Fusion
- Re-embed notes on file changes using existing watcher hooks
- Full reindex support via the existing `/api/search/reindex` endpoint

## Capabilities

### New Capabilities
- `semantic-search`: Local ONNX-based embedding generation, vector storage in SQLite, chunking by markdown headings, cosine similarity search, and hybrid result merging with FTS5 via Reciprocal Rank Fusion

### Modified Capabilities

_(none — no existing spec-level requirements change, the search API contract stays the same)_

## Impact

- **Dependencies**: New packages — `onnxruntime-node`, `sqlite-vec` (or vector BLOB storage with JS-side cosine similarity)
- **Backend code**: `SearchService` gains embedding/chunking/hybrid merge logic. New SQLite table for embeddings.
- **MCP server**: No changes needed — uses the same `search_notes` tool / `/api/files/search` endpoint
- **Performance**: First-time indexing will be slower (embedding generation). Incremental updates via watcher stay fast for single notes.
- **Portability**: Embedding logic stays in application code, making future migration to PostgreSQL + pgvector straightforward
