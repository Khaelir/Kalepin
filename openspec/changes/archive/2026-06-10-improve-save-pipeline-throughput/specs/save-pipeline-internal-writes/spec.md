## ADDED Requirements

### Requirement: Internal-write event channel
`FileWatcherService` SHALL expose a method `emitInternalWrite(path: string, content: string)` that subscribers can register for via `onInternalWrite(callback)`. The event SHALL be emitted by every code path that writes to storage with content already in process memory: `OTService` flush handler, `FilesService.writeNote`, `FilesService.createFile`, and any future server-side write that has the post-write content in hand.

#### Scenario: OT flush emits internal write
- **WHEN** the OT session manager flushes a document to storage
- **THEN** `emitInternalWrite(docId, content)` is called immediately after `storage.write` resolves successfully
- **AND** all registered internal-write subscribers receive the event with the same content the flush wrote

#### Scenario: FilesService write emits internal write
- **WHEN** `FilesService.writeNote(path, content)` or `FilesService.createFile(path, content)` writes a file to storage
- **THEN** `emitInternalWrite(path, content)` is called after the storage write resolves successfully

#### Scenario: External writes do not emit internal write
- **WHEN** a file is modified outside the application (e.g., by Obsidian on disk, by an admin restore not routed through `FilesService`)
- **THEN** no internal-write event fires; only the chokidar-driven `onFileChange` event fires

### Requirement: Chokidar dedup window for internal writes
`FileWatcherService` SHALL maintain a short-lived `(path, mtime) → expiry` map of recently completed internal writes. When a chokidar event fires for a path whose `(path, mtime)` is present in the map, the event SHALL be suppressed (not delivered to `onFileChange` subscribers). The map entry SHALL expire 1 second after insertion.

#### Scenario: Internal write suppresses subsequent chokidar event
- **WHEN** an internal write occurs at `notes/foo.md` and produces mtime M
- **AND** chokidar fires a `change` event for `notes/foo.md` within 1 s with the same mtime M
- **THEN** the chokidar event is suppressed and `onFileChange` subscribers do NOT receive it

#### Scenario: External write with different mtime is not suppressed
- **WHEN** an internal write occurs at `notes/foo.md` with mtime M1
- **AND** an external write occurs at the same path with mtime M2 (M2 ≠ M1) within 1 s
- **THEN** the chokidar event for M2 is NOT in the dedup map and IS delivered to `onFileChange` subscribers

#### Scenario: Dedup window expires
- **WHEN** an internal write occurs at `notes/foo.md` with mtime M
- **AND** more than 1 s passes
- **AND** a chokidar event later fires for `notes/foo.md` with mtime M
- **THEN** the dedup map no longer holds the entry and the chokidar event is delivered to `onFileChange` subscribers

#### Scenario: Atomic-write event sequence is fully suppressed
- **WHEN** an internal write completes via temp+rename
- **AND** chokidar emits `unlink` followed by `add` (instead of `change`) for the path within the dedup window
- **THEN** both events are suppressed when their resolved mtimes match the dedup entry

### Requirement: Heal sweep reconciles index against disk
A periodic background sweep SHALL run every 10 minutes that compares each indexed path's stored `indexed_mtime` against the actual disk mtime via `fs.stat`. Any path whose disk mtime is newer than the stored `indexed_mtime`, or whose `indexed_mtime` is NULL, SHALL be re-indexed. Any path absent from disk SHALL have its index rows removed.

#### Scenario: Drift detected on healthy path
- **WHEN** the heal sweep runs and finds a path whose disk mtime is later than its stored `indexed_mtime`
- **THEN** the system reads the file, re-indexes it (FTS5 row replaced, link records replaced), and updates `indexed_mtime` to the disk mtime

#### Scenario: NULL stored mtime is treated as drift
- **WHEN** the heal sweep encounters a path whose `indexed_mtime` is NULL (e.g., legacy row pre-migration)
- **THEN** the path is re-indexed and `indexed_mtime` is set to the current disk mtime

#### Scenario: Indexed file has been deleted from disk
- **WHEN** the heal sweep runs and finds a path that exists in the index but `fs.stat` raises ENOENT
- **THEN** the system removes all index rows for that path (FTS5 row, link rows, embedding rows)

#### Scenario: Sweep schedule is independent of request path
- **WHEN** the application is under heavy save load
- **THEN** the heal sweep continues to run on its 10-minute schedule via `setInterval`, not blocked by request-path work

#### Scenario: Sweep cost on large vault
- **WHEN** the sweep runs against a vault of 5 000 indexed paths
- **THEN** the sweep completes in under 5 seconds and issues approximately 5 000 `fs.stat` calls without performing reads for unchanged files

### Requirement: Indexers prefer internal-write content over disk read
`SearchService` and `LinkIndexService` SHALL register handlers that consume the internal-write event with the in-memory content. When the internal-write event delivers `(path, content)`, the indexer SHALL update its index using that content directly without calling `storage.read(path)`.

#### Scenario: Internal write feeds search indexer without disk read
- **WHEN** an internal-write event fires with `(path, content)`
- **THEN** `SearchService.indexNote(path, content)` is called and `storage.read(path)` is NOT called for this update

#### Scenario: External chokidar event still triggers disk read
- **WHEN** a chokidar `change` event fires for a path with no matching dedup entry
- **THEN** `SearchService` and `LinkIndexService` fall back to `storage.read(path)` to obtain content
