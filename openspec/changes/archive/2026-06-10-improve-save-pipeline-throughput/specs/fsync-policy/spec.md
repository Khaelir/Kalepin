## ADDED Requirements

### Requirement: Two-tier atomic-write durability
`LocalFSAdapter` SHALL expose two methods for atomic file writes with distinct durability semantics: `writeBytesAtomic(path, content)` (best-effort, no fsync) and `writeBytesAtomicDurable(path, content)` (fsync of file and parent directory). Both methods SHALL provide atomicity (the path is observed as either the prior content or the new content, never partial).

#### Scenario: Best-effort write does not fsync
- **WHEN** a caller invokes `writeBytesAtomic("notes/foo.md", buf)`
- **THEN** the adapter writes a temp file, renames it onto the target path, and returns
- **AND** no `handle.sync()` is performed

#### Scenario: Durable write fsyncs file and parent directory
- **WHEN** a caller invokes `writeBytesAtomicDurable("backups/2026-05-07.tar", buf)`
- **THEN** the adapter writes a temp file, fsyncs the file handle, renames it onto the target path, fsyncs the parent directory, and returns

#### Scenario: Backup writes use the durable variant
- **WHEN** the admin backup writer creates or overwrites a backup file
- **THEN** the underlying call is `writeBytesAtomicDurable`, not `writeBytesAtomic`

#### Scenario: Restore writes use the durable variant
- **WHEN** the admin restore code path writes a file from a backup
- **THEN** the underlying call is `writeBytesAtomicDurable`

#### Scenario: Encryption sweep writes use the durable variant
- **WHEN** the encryption sweep migrates a file between encrypted/plain at-rest states
- **THEN** the underlying call is `writeBytesAtomicDurable`

#### Scenario: OT flush writes use the best-effort variant
- **WHEN** the OT session manager flushes a document via the configured flush handler
- **THEN** the underlying call resolves to `writeBytesAtomic` (no fsync) on the local adapter

#### Scenario: FilesService writes use the best-effort variant
- **WHEN** `FilesService.writeNote` or `FilesService.createFile` writes content
- **THEN** the underlying call resolves to `writeBytesAtomic` (no fsync) on the local adapter

### Requirement: Background fsync coalescer bounds writeback gap
The system SHALL run a background fsync coalescer that maintains a set of paths recently written via `writeBytesAtomic` and issues an OS-level flush for those paths every 2 seconds. The coalescer SHALL also flush all pending paths before process exit.

#### Scenario: Coalescer flushes recently-written paths on its interval
- **WHEN** a `writeBytesAtomic` call completes for `notes/foo.md`
- **AND** within 2 seconds no further write to that path occurs
- **THEN** the coalescer issues an fsync (or `sync()`) covering the path and removes it from its dirty set

#### Scenario: Coalescer flushes on graceful shutdown
- **WHEN** the process receives `beforeExit` (or a captured SIGTERM) with paths still in the coalescer's dirty set
- **THEN** the coalescer synchronously fsyncs all dirty paths before the process exits

#### Scenario: Coalescer continues operating under heavy save load
- **WHEN** save throughput causes many paths to enter the dirty set
- **THEN** the coalescer's 2-second interval continues to fire (it is `setInterval`-driven, not awaited from a request handler)
- **AND** the dirty set is bounded by the number of unique paths within any 2-second window, not by the total save count

#### Scenario: Durable writes do not enter the coalescer
- **WHEN** a `writeBytesAtomicDurable` call completes
- **THEN** the path is NOT added to the coalescer's dirty set (the write is already on platter)

### Requirement: Documented durability semantics for OT-flushed content
After this change, the `Saved` state for OT-flushed content SHALL mean: the kernel has accepted the bytes and will flush them to disk within at most 2 seconds (bounded by the coalescer interval). It SHALL NOT mean the bytes are guaranteed on physical platter at the moment the indicator flips.

#### Scenario: Tab close after Saved indicator
- **WHEN** the editor displays Saved and the user closes the browser tab
- **THEN** the bytes are durable (the kernel will flush regardless of the tab state)

#### Scenario: Process crash after Saved indicator
- **WHEN** the editor displays Saved and the server process crashes
- **THEN** the bytes are durable (the kernel will flush regardless of the process exiting)

#### Scenario: Hard power loss within the writeback gap
- **WHEN** the editor displays Saved and hard power loss occurs within 2 seconds of the `Saved` transition
- **THEN** the most recent save MAY be lost; all earlier saves (older than 2 s) are durable
