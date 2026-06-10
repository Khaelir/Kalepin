## MODIFIED Requirements

### Requirement: Incremental re-index on file change
The system SHALL update the link index for a single file when it is created, modified, or deleted. The system SHALL prefer in-memory content delivered via the internal-write event channel over re-reading from disk; it SHALL fall back to `storage.read` only for chokidar events not preceded by a matching internal write. Each source path SHALL store an `indexed_mtime` value used by the heal sweep.

#### Scenario: File modified
- **WHEN** a `.md` file is modified (content changes detected by file watcher)
- **THEN** the system deletes all link records where `source_path` equals the changed file, re-parses the file's content, and inserts new link records

#### Scenario: File deleted
- **WHEN** a `.md` file is deleted
- **THEN** the system deletes all link records where `source_path` equals the deleted file

#### Scenario: File created
- **WHEN** a new `.md` file is created
- **THEN** the system parses the file's content and inserts link records

#### Scenario: Internal write skips disk read
- **WHEN** an internal-write event fires for `notes/foo.md` with content `C`
- **THEN** `LinkIndexService` parses links from `C` directly without calling `storage.read("notes/foo.md")`
- **AND** `indexed_mtime` is set to the disk mtime of the file

#### Scenario: Heal sweep catches dedup miss
- **WHEN** an external writer changes a file in a way that the dedup window suppressed
- **AND** the 10-minute heal sweep runs
- **THEN** the sweep observes that the on-disk mtime exceeds `indexed_mtime` and re-parses the file's links
