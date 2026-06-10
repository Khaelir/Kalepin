## MODIFIED Requirements

### Requirement: LocalFS adapter
The system SHALL provide a `LocalFSAdapter` that performs file operations using Node.js `fs` APIs. This adapter covers local bind mounts and NFS mounts (NFS is transparent at the filesystem API level). The adapter SHALL provide two atomic-write methods with distinct durability semantics: `writeBytesAtomic` (best-effort, no fsync) and `writeBytesAtomicDurable` (fsync of file and parent directory). Both methods SHALL guarantee atomicity on the target path.

#### Scenario: Read file
- **WHEN** the adapter reads a file at a given path
- **THEN** it returns the file content as a string using `fs.readFile`

#### Scenario: Write file
- **WHEN** the adapter writes content to a file path via `write` (string content) or `writeBytes` (buffer content)
- **THEN** it creates or overwrites the file on disk using `fs.writeFile`

#### Scenario: Best-effort atomic write does not fsync
- **WHEN** a caller invokes `writeBytesAtomic(path, content)`
- **THEN** the adapter writes a temp file via `fs.writeFile`, performs `fs.rename` onto the target path, and returns
- **AND** no `fsync` is performed on the file or the directory

#### Scenario: Durable atomic write fsyncs file and directory
- **WHEN** a caller invokes `writeBytesAtomicDurable(path, content)`
- **THEN** the adapter writes a temp file, opens it, calls `handle.sync()` on the file, closes, performs `fs.rename`, then opens the parent directory and calls `sync()` on it before returning

#### Scenario: Atomicity guarantee under concurrent reads
- **WHEN** a reader accesses the path during either atomic-write variant's execution
- **THEN** the reader observes either the previous content or the new content, never partial bytes

#### Scenario: Watch for changes
- **WHEN** the adapter starts watching the vault directory
- **THEN** it uses chokidar to emit events for file create, modify, and delete
