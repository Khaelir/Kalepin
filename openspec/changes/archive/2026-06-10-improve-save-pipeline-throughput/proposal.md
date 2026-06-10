## Why

A user reported losing work after closing a tab while "saving" took multiple seconds on a large note in a large vault. The data-loss aspect (buffered ops on the client) is being addressed in a separate proposal. This proposal targets the **perceived slowness** of saves: today, every flush triggers a chain of work whose cost scales linearly with document size and indirectly with vault size, none of which structurally needs to.

The cumulative cost on the OT flush hot path includes a redundant full-file read+decrypt by the search and link indexers, an `fsync` stall on every atomic write, and inline ONNX inference for embeddings — all running on the main event loop and contending with the next save.

## What Changes

### Phase 1 — Internal-write channel + heal sweep
- `FileWatcherService` exposes a new internal-write event carrying `(path, content)` for writes the server already has in memory.
- `OTService` flush handler and `FilesService.writeNote` emit on this channel after writing.
- `SearchService` and `LinkIndexService` consume internal writes directly, skipping `storage.read(path)` and the decrypt step.
- A short-lived `(path, mtime)` dedup window (set BEFORE rename) suppresses the corresponding chokidar event, preventing wasted double-indexing.
- A periodic heal sweep (~10 min) re-indexes any file whose disk-mtime differs from its stored index mtime, bounding the cost of any dedup miss.

### Phase 2 — fsync split + coalescer
- `LocalFSAdapter` exposes two methods: `writeBytesAtomic` (no fsync, used by OT flush) and `writeBytesAtomicDurable` (with fsync, used by backup writes, restore, and the encryption sweep).
- A background fsync coalescer runs every ~2s, bounding the durability window without paying per-write cost.
- **Behavioral change (documented):** after this phase, "Saved" means the kernel has accepted the bytes and will flush within ~2 s, not "physically on platter." This matches Obsidian, VSCode, and most editors in this category, but is a real (small) durability degradation under hard power loss.

### Phase 3a — Embedding deferral while OT session is active
- `SearchService` defers `indexNoteEmbeddings` for documents with connected OT clients.
- A per-doc 45-second inactivity timer is reset on each flush; the embedding runs when the timer fires or on session close.
- A safety cap forces an embedding pass at least every 5 minutes during continuous typing.
- FTS5 indexing remains synchronous per-flush (it is cheap). Only the embedding step is deferred.

### Phase 3b — DEFERRED — Embeddings worker pool
- Capture the design for moving ONNX inference to a `worker_threads` pool so it never runs on the request process.
- Marked deferred. Revisit only if Phase 3a does not sufficiently relieve event-loop pressure under load.

## Capabilities

### New Capabilities
- `save-pipeline-internal-writes`: Internal write-event channel for in-memory writes (OT flushes, FilesService writes), the chokidar dedup window protecting it, and the periodic heal sweep that converts dedup misses from "stale forever" into "stale for up to 10 min."
- `fsync-policy`: Per-call durability tier on `LocalFSAdapter` and the background fsync coalescer that bounds the writeback window for non-durable writes.
- `embedding-deferral`: Defer-while-session-active policy for the semantic-search embedding pipeline, with inactivity timer, session-close flush, and a safety cap.

### Modified Capabilities
- `full-text-search`: `SearchService` consumes internal-write events with content in hand; falls back to `storage.read` only on chokidar events not preceded by a matching internal write.
- `link-index`: `LinkIndexService` consumes internal-write events with content in hand; falls back to `storage.read` for genuinely external writes.
- `semantic-search`: Embedding indexing is no longer synchronous-per-save for documents with active OT sessions; semantic-search results may be up to 45 s stale (typing inactivity) or 5 min stale (continuous typing) for the actively edited document.
- `storage-adapters`: `writeBytesAtomic` no longer fsyncs; a new `writeBytesAtomicDurable` method preserves the previous semantics for callers that require platter durability.
- `save-status`: Durability semantics of the `Saved` state change from "on platter" to "with the kernel, durable within ~2 s." User-visible UI text MAY remain "Saved" as this matches industry norms.

## Impact

**Affected code:**
- `packages/backend/src/files/file-watcher.service.ts` — adds internal-write event channel
- `packages/backend/src/storage/local-fs.adapter.ts` — `writeBytesAtomic` no-fsync, new `writeBytesAtomicDurable`, coalescer
- `packages/backend/src/storage/encrypting-fs.adapter.ts` — routes durable vs non-durable writes
- `packages/backend/src/ot/ot.service.ts` — flush handler emits internal-write event
- `packages/backend/src/files/files.service.ts` — `writeNote` and similar paths emit internal-write event
- `packages/backend/src/search/search.service.ts` — consumes internal writes; defers embeddings; heal sweep registration
- `packages/backend/src/links/link-index.service.ts` — consumes internal writes
- `packages/backend/src/admin/...` — backup/restore code paths verified to use `writeBytesAtomicDurable`

**No external API changes.** Front-end protocol (OT WebSocket, REST) is unchanged.

**Durability behavior change** for OT flushes (documented above).

**Compatibility:** Existing on-disk vault layout is unchanged. Existing FTS5 / embeddings tables get a new `mtime` column for the heal sweep (additive migration).
