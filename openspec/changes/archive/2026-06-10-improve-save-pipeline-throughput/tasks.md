## 1. Phase 2 — fsync split (ship first; smallest blast radius, biggest single-flush win)

- [x] 1.1 Audit all current callers of `LocalFSAdapter.writeBytesAtomic` and classify each as best-effort or durable. List in the PR description.
- [x] 1.2 Add `writeBytesAtomicDurable(path, content)` to `LocalFSAdapter` (file fsync + rename + parent-directory fsync).
- [x] 1.3 Update `EncryptingFSAdapter` and `RoutingFSAdapter` to expose the new durable method (delegating where appropriate).
- [x] 1.4 Update the `StorageAdapter` interface in `storage-adapter.interface.ts` and any test doubles.
- [x] 1.5 Switch admin backup writes (`admin/backup/*`) to `writeBytesAtomicDurable`. (No-op: `BackupService` writes archives via `tar.create` + S3 stream upload — no `writeBytesAtomic` callers exist on this path.)
- [x] 1.6 Switch admin restore writes to `writeBytesAtomicDurable`. (No-op: `ArchiveService.restoreFromArchive` uses `fs.cp`/`fs.rename` for the staged swap — no `writeBytesAtomic` callers exist on this path.)
- [x] 1.7 Switch encryption-sweep writes to `writeBytesAtomicDurable`. (Updated `MigrationSweepService`'s private `atomicWrite` helper to fsync the parent directory after rename, matching durable semantics.)
- [x] 1.8 Remove `handle.sync()` from `LocalFSAdapter.writeBytesAtomic`.
- [x] 1.9 Implement the background fsync coalescer service: `Set<string>` dirty paths, `setInterval(2000)` flush, `process.on('beforeExit', ...)` final flush.
- [x] 1.10 Wire `writeBytesAtomic` to `coalescer.markDirty(resolvedPath)`; do NOT mark for `writeBytesAtomicDurable`.
- [x] 1.11 Add startup check: verify vault directory is writable and a `sync()` on a temp file succeeds; fail loud at module init if not.
- [x] 1.12 Update `save-status` UI text and the in-app docs/help if they currently claim "fully on disk." Confirm wording matches the new `save-status` requirement scenarios.
- [x] 1.13 Unit tests: `writeBytesAtomic` does not call fsync; `writeBytesAtomicDurable` calls fsync on file and parent directory; coalescer flushes on interval and on `beforeExit`.
- [x] 1.14 Integration test: write a file via `writeBytesAtomic`, verify it is observable on disk (read back) immediately; verify atomicity (no partial reads under concurrent reader).

## 2. Phase 3a — Embedding deferral while OT session is active

- [x] 2.1 In `SearchService`, add a per-doc holding map `Map<string, { content: string; firstDeferredAt: number }>` and a per-doc inactivity timer map.
- [x] 2.2 Refactor `indexNoteEmbeddings` into `embedNow(path, content)` (existing inference + DB upsert) and a new `scheduleEmbedding(path, content)` entry point.
- [x] 2.3 In `scheduleEmbedding`, check `OTSessionManager.getSession(path)?.clients.size`: if zero, call `embedNow` synchronously; if non-zero, store content and (re)set a 45 s inactivity timer.
- [x] 2.4 On timer fire, call `embedNow(path, latestHeldContent)` and remove the path from the holding map.
- [x] 2.5 Implement the per-doc 5-minute safety cap: when first deferring a path, also set a separate timer; if it fires before the 45 s timer, force `embedNow` regardless of activity.
- [x] 2.6 Subscribe to `OTService.setSessionCloseHandler` (or expose a new hook) so session close runs any pending `embedNow`. (Added `OTService.addSessionCloseListener` multi-listener hook.)
- [x] 2.7 Subscribe to `process.on('beforeExit', ...)` to drain pending embeddings synchronously up to a 30 s budget; remaining paths log a warning and rely on the heal sweep at next startup.
- [x] 2.8 Update existing `SearchService` event handlers to call `scheduleEmbedding` instead of `indexNoteEmbeddings`.
- [x] 2.9 Unit tests: deferral when session active; immediate when no session; timer reset on repeated flush; safety cap; session-close flush; shutdown drain.

## 3. Phase 1 — Internal-write channel, dedup, and heal sweep

- [x] 3.1 Add `emitInternalWrite(path, content)` and `onInternalWrite(callback)` to `FileWatcherService`. Internal handler list separate from chokidar handler list.
- [x] 3.2 Add a `Map<string, { mtime: number; expiresAt: number }>` dedup map to `FileWatcherService` plus a `markRecentInternalWrite(path, mtime)` method that inserts with a 1 s TTL.
- [x] 3.3 Wrap chokidar dispatch: on each chokidar event, look up the dedup entry; if `mtime` matches and entry not expired, drop; otherwise dispatch.
- [x] 3.4 In `OTService.setFlushHandler`, after `storage.write` resolves, capture the resolved disk mtime via `storage.stat(docId)`, call `markRecentInternalWrite(docId, mtime)`, then `emitInternalWrite(docId, content)`.
- [x] 3.5 In `FilesService.writeNote` and `FilesService.createFile`, after the storage write, perform the same mtime capture + dedup mark + internal-write emit. (Instrumented `createFile`, `patchFile`, `appendToFile` via private `announceInternalWrite` helper.)
- [x] 3.6 Create the `notes_fts_meta` table (migration): `path TEXT PRIMARY KEY`, `indexed_mtime INTEGER NULL`. Backfill empty (NULL means "always re-index" until populated).
- [x] 3.7 Add `indexed_mtime` column to wherever link-index per-source state lives (or a sibling `note_links_meta` table if cleaner). (Created sibling `note_links_meta` table.)
- [x] 3.8 In `SearchService`, register an internal-write handler that calls `indexNote(path, content)` directly (no `storage.read`) and updates `indexed_mtime`.
- [x] 3.9 In `SearchService`, update the existing chokidar handler to fall through only when no dedup match exists, and to also write `indexed_mtime` after re-reading.
- [x] 3.10 Mirror 3.8 and 3.9 in `LinkIndexService` for `indexFile`.
- [x] 3.11 Implement `SearchService.healSweep()`: query all `(path, indexed_mtime)` rows; for each, `fs.stat`; reindex if disk-mtime > indexed-mtime or NULL; remove rows for ENOENT paths.
- [x] 3.12 Mirror 3.11 in `LinkIndexService.healSweep()`.
- [x] 3.13 Schedule both heal sweeps via a single `setInterval(10 * 60 * 1000)` registered at module init. (Each service registers its own interval at module init; same cadence.)
- [x] 3.14 Unit tests: internal-write emit triggers indexer without disk read; chokidar event with matching dedup is dropped; chokidar event with non-matching mtime is delivered; dedup TTL expiry; heal sweep reindexes drift; heal sweep removes deleted paths.
- [x] 3.15 Integration test: under simulated load (20 saves to one doc in 5 s), assert no `storage.read` calls were made by `SearchService` or `LinkIndexService` for that doc.

## 4. Verification and rollout

- [x] 4.1 Run the full backend test suite: `npx nest build` then `node --test dist/backend/src/...test.js` (per project convention). (907/907 tests pass after this change.)
- [ ] 4.2 Run a manual perf check: with a 500 KB note in a 2 000-note vault, time the SYNCED indicator transition. Compare before/after. (Manual — not run.)
- [ ] 4.3 Manual test: tab-close after Saved indicator → reload → content present. (Manual — not run.)
- [ ] 4.4 Manual test: external `echo "x" >> notes/foo.md` from shell → within 10 min the FTS search reflects "x" via heal sweep. (Manual — not run.)
- [x] 4.5 Update the project README or `packages/backend/README.md` if save semantics are documented anywhere user-facing. (Reviewed; existing README does not claim platter durability for OT-flushed content. Frontend StatusBar updated: "Saved to disk" → "Saved".)
- [x] 4.6 Verify each spec scenario has at least one corresponding test (or a manual-test checklist line) before declaring the change done. (Audit: storage-adapters, fsync-policy coalescer, embedding-deferral, save-pipeline-internal-writes scenarios covered by automated tests; durability-under-power-loss scenarios marked manual.)

## 5. Phase 3b — Embeddings worker pool — DEFERRED

- [ ] 5.1 DEFERRED — Do not implement in this change. Revisit if event-loop lag metrics show sustained spikes during embedding bursts after Phase 3a is shipped.
- [ ] 5.2 DEFERRED — Design captured in `design.md` section D7. Future work: spawn `worker_threads` pool of size `cpu-count - 1`; load model once per worker; message protocol `{ id, path, type, text|texts }` → `{ id, vectors }`; coalesce by path (newer job cancels older queued job for same path).
