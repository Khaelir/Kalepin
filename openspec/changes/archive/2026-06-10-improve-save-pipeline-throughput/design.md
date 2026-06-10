## Context

The OT save flow today: keystroke → WS op → server applies in memory → 3-second debounce → `flushToDisk` → `storage.write()` → `fs.writeFile` (with atomic rename + `fsync`) → chokidar fires → `SearchService` and `LinkIndexService` each read+decrypt the just-written file → FTS5 update + ONNX inference for embeddings + link parse, all on the main event loop.

Observed symptoms from the user report: a large note (≥200 KB) in a vault with many other notes feels slow to save (multiple seconds of "Saving…"). Investigation found three structurally redundant or unnecessarily strict steps on or adjacent to the user-perceived hot path:

- **Two redundant disk reads + decrypts** after every flush, by `SearchService` and `LinkIndexService`, of bytes the OT layer already has in memory.
- **`fsync` per atomic write** — required only for hard-power-loss durability, never for tab-close or process-crash safety. Costs 20–200 ms per call on contended disks.
- **Inline ONNX embedding inference** — runs on the main event loop, ~50–100 ms per chunk × N chunks per save, after every flush, even while the user is mid-burst typing on the same doc.

These compound: each save's post-flush work delays the event-loop budget the *next* save needs.

Out of scope: the data-loss-on-tab-close threat (separate proposal); OT engine `apply()` rebuild cost; git adapter (being removed).

## Goals / Non-Goals

**Goals:**
- Eliminate redundant read+decrypt for OT-mediated and FilesService-mediated writes.
- Move `fsync` off the OT flush hot path while bounding the writeback window for non-durable writes.
- Move embedding inference off the user's typing-burst hot path entirely.
- Preserve correctness: FTS, link, and embedding indexes MUST eventually reflect every write that lands on disk, including externally written files.
- Preserve durability for backup/restore/encryption-sweep callers that explicitly require platter-durability.

**Non-Goals:**
- Multi-process scaling, sharding, or distributed indexing.
- Replacing `apply()` with a non-O(N) data structure.
- Client-side persistence of buffered ops (separate proposal).
- Migrating to Yjs/CRDT (see project memory: deferred).
- Implementing the embeddings worker pool (Phase 3b — captured here, deferred).

## Decisions

### D1: Internal-write event channel separate from chokidar

`FileWatcherService` exposes a new event method, semantically `internalWrite(path, content)`, in addition to the existing chokidar-driven `onFileChange`. Subscribers (search, links, future indexers) register a single handler that accepts `(event, content?)` — when `content` is provided, the subscriber skips `storage.read`.

**Why over alternatives:**
- Alternative: emit `file:written` (the existing event from `external-write-sync`) on every OT flush. Rejected — `file:written` already has a contract (resets active OT sessions, emits `doc:reload`); reusing it for in-process indexing routing would force OT-flush events to also touch their own session, which is a no-op at best and a re-entrancy hazard at worst.
- Alternative: have search/links keep using chokidar but stash content in a side-table the OT flush populates. Rejected — adds a stateful intermediary, the lookup window is identical to the dedup window, and the path is harder to reason about.

The internal-write channel is purely additive and the existing chokidar path remains the source of truth for genuinely external writes (Obsidian-on-disk, MCP, restore, encryption sweep when not invoked through the new path).

### D2: `(path, mtime)` dedup window, populated BEFORE rename

When the OT flush handler is about to call `storage.writeBytesAtomic`, it:
1. Reads the would-be mtime ahead of the write — actually, simpler: it captures the mtime AFTER the rename (atomic, observed via `fs.stat`) and adds `(path, mtime)` to a `Map<string, number>` with a 1-second TTL.
2. Emits the internal-write event.

When chokidar fires for the same `(path, mtime)` within the window, the watcher dispatch path drops it. After 1 s the entry expires.

**Why this ordering works:** the rename is atomic; the moment `rename` returns, both the mtime and the visible content are committed. chokidar reads the inode change asynchronously (FSEvents on macOS has a ~10–30 ms delay; inotify on Linux is sub-ms but still post-rename). So by the time chokidar's callback runs, the dedup entry is already in the map. The 1 s TTL is generous — chokidar typically fires within tens of ms of the rename.

**Edge cases handled:**
- Atomic-write detection: chokidar's emitted sequence may be `change` only, or `unlink` + `add`, depending on platform. The dedup matches on `(path, mtime)` regardless of event type.
- Encrypted-FS layer: the encrypting adapter wraps the local FS. The mtime read happens at the local-FS layer, not the virtual-path layer. The internal-write event uses the virtual path; the chokidar event also reports the virtual path (after the routing FS adapter's path mapping). They match.

### D3: Periodic heal sweep — converts dedup miss into bounded staleness

A `SearchService.healSweep()` (and analogous `LinkIndexService.healSweep()`) runs every 10 minutes:

```
SELECT path, indexed_mtime FROM notes_fts_meta;
For each (path, indexed_mtime):
  disk_mtime = fs.stat(resolve(path)).mtime
  if disk_mtime > indexed_mtime:
    re-index(path)
```

This requires extending the FTS5 / link-index storage with an `indexed_mtime` column (additive migration; default to NULL, healed on first sweep). Stored as Unix epoch ms.

Cost: one `stat` per indexed path per 10 min. For 5 000 notes: 5 000 stats every 10 min ≈ 8/s — negligible.

**Why a sweep instead of a stronger dedup:** the dedup is the fast path for the common case; the sweep is the correctness backstop. Trying to make dedup bulletproof creates a coupling between the FS layer and the indexer that we don't want.

### D4: `writeBytesAtomic` no fsync; new `writeBytesAtomicDurable` for callers that need it

`LocalFSAdapter`:
- `writeBytesAtomic(path, content)` — writes temp + rename, no `handle.sync()`. Used for OT flush, FilesService.writeNote, and any other "best-effort durability" path.
- `writeBytesAtomicDurable(path, content)` — writes temp + `handle.sync()` + rename + `dirHandle.sync()` (also fsync the parent directory to durably commit the rename). Used for backup writes, restore, encryption-sweep, admin rebuilds.

`EncryptingFSAdapter`'s `writeBytesAtomic` continues to delegate to inner. We add the durable variant alongside.

**Why fsync the parent directory in the durable path:** the rename's metadata isn't durable until the directory inode is fsynced. Today's code doesn't do this; we're upgrading the "durable" path even as we drop the default path.

### D5: Background fsync coalescer — bound the writeback window

A small in-process service maintains a `Set<string>` of recently-written-but-not-fsynced paths. Every 2 seconds, it issues a single `sync()` (Linux) or per-file `fsync` of the set members (macOS, where `sync(2)` is a hint), then clears the set.

```
writeBytesAtomic(path, content) → ... rename ... → coalescer.markDirty(path)
                                                         │
                                                         ▼
                                                  every 2 s: flush all
```

This bounds the durability gap to ~2 s for any "best-effort" write. Failure-mode honesty: hard power loss in the 2-second window may lose the last write, but no other write before it.

The coalescer registers a `process.on('beforeExit')` handler that fsyncs the set on graceful shutdown.

### D6: Embedding deferral via per-doc inactivity timer keyed on active OT session

`SearchService.indexNoteEmbeddings` is split into:
- `scheduleEmbedding(path, content)` — the new entry point called from the internal-write/chokidar pipeline.
- `embedNow(path, content)` — internal, runs the actual ONNX inference + DB upsert.

Logic:
1. If the document has no active OT session (`!OTSessionManager.getSession(path)?.clients.size`): call `embedNow` immediately (no behavior change for non-OT writes, e.g., MCP-created notes).
2. If it has an active session: store the latest content in a per-doc holding map; reset a 45 s timer; when the timer fires, call `embedNow(path, latestContent)`.
3. A per-doc safety timer (5 min) ensures a doc gets embedded at least every 5 min even under continuous typing.
4. On session close (subscribed via `OTService.setSessionCloseHandler`), if a deferred embedding exists, run it.
5. On server shutdown: flush all pending deferred embeddings.

**Why session-active and not just inactivity:** non-OT writes (MCP append, file restore) should embed immediately — they have no concept of an active typing session. Gating on `clients.size > 0` cleanly separates the two cases.

**FTS5 stays per-write:** SQLite FTS5 INSERT for a single-doc body is cheap (single-digit ms even for 1 MB); deferring it provides little upside and complicates the model.

### D7: Phase 3b — Worker pool design (deferred)

Captured for future implementation; not built in this change.

```
EmbeddingWorkerPool
├── N workers (cpu-count - 1, min 1)
├── each worker loads the model at startup (cost: ~200 MB RAM × N)
├── job protocol: { id, path, type: 'embed'|'embedBatch', text|texts }
├── result: { id, vectors: Float32Array[] }
└── coalescing: a newer job for the same `path` cancels older queued jobs
```

When to revisit: if metrics show `event_loop_lag > 100 ms` correlated with embedding bursts after Phase 3a is shipped.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Dedup window misses an external write that happens to land in the same mtime tick → indexer skips it → stale FTS/links until next change | Heal sweep (D3) catches it within 10 min; double-indexing (when dedup *fails open*) is idempotent so the fallback is correctness, not corruption |
| Hard power loss within ~2 s of a save loses that save's bytes | Documented in proposal; matches Obsidian/VSCode/most editors. Backup writes use `writeBytesAtomicDurable` |
| `(path, mtime)` collision when an external writer preserves mtime (`touch -r`, restore-with-original-mtime) | Heal sweep catches drift between in-memory session content and disk; the writer paths that explicitly preserve mtime (none today) would need to be flagged. No current callers do this. |
| Embedding deferral makes semantic-search results stale by up to 45 s for an actively-edited doc | FTS5 stays current per-write; semantic search is already best-effort with a 0.4 cosine threshold. 45 s lag is below user-noticeable for "find what I just wrote" scenarios |
| Heal sweep adds 5 000 `stat` calls per 10 min | Negligible; `stat` is sub-ms; runs on a background interval, not the request path |
| `writeBytesAtomicDurable` parent-directory fsync is new behavior — could mask a previously-silent FS misconfiguration | Add a startup check (verify `vault` directory is writable + fsync-capable) to fail loud at module init rather than at first durable write |
| Coalescer interval skipped during heavy load → durability gap grows | Coalescer uses `setInterval` (immune to event-loop blocking longer than the interval, which would already be a separate problem). On `beforeExit` we fsync remaining dirty paths |

## Migration Plan

This is a backend-only refactor with no on-disk format change.

**Schema migration:**
- Add `indexed_mtime INTEGER NULL` to whatever table tracks per-path indexing state for FTS5 (a new `notes_fts_meta` table; FTS5 virtual tables don't accept arbitrary columns) and for `note_links`.
- Old rows have `indexed_mtime = NULL`; the heal sweep treats NULL as "always re-index" until populated.

**Rollout:**
1. Phases 1–3a are independent and can ship in any order. Recommended: 2 first (smallest blast radius, biggest single-flush win), then 3a, then 1.
2. Each phase ships behind no feature flag — they're internal architectural changes with no user-facing protocol surface.
3. `writeBytesAtomicDurable` callers are audited in a single commit before `writeBytesAtomic` drops fsync, to avoid a window where backup writes are no-fsync.

**Rollback:** revert any phase independently. The internal-write channel is additive (subscribers still handle chokidar events). The fsync change is one method's body. The embedding deferral is one conditional in `SearchService`.

## Open Questions

- **Q1:** Should the heal sweep also detect indexed-but-deleted files (a file present in `notes_fts_meta` whose path no longer exists on disk)? Yes — answer is straightforward, just `unlink` the index row. Mentioned for completeness.
- **Q2:** Is there a use case where a caller wants `writeBytesAtomic` semantics but ALSO wants the chokidar event to fire (i.e., not be deduped)? Not today. If one emerges, the flush handler can be parameterized.
- **Q3:** Per-doc embedding 5-min safety cap — should this be configurable? Default 5 min seems sensible; expose via env var for ops if requested.
