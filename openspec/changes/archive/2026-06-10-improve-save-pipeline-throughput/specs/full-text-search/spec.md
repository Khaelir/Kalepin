## MODIFIED Requirements

### Requirement: Automatic index updates
The system SHALL keep the FTS5 index in sync with note content by indexing on file create, update, and delete events. The system SHALL prefer in-memory content delivered via the internal-write event channel over re-reading from disk; it SHALL fall back to `storage.read` only for chokidar events not preceded by a matching internal write. Each indexed path SHALL store an `indexed_mtime` value used by the heal sweep to detect drift.

#### Scenario: New note indexed
- **WHEN** a user creates a new note at path "projects/design.md" with content "System architecture overview"
- **THEN** the note becomes searchable by "architecture" immediately after creation

#### Scenario: Updated note re-indexed
- **WHEN** a user updates a note to add the text "migration strategy"
- **THEN** searching for "migration strategy" returns that note

#### Scenario: Deleted note removed from index
- **WHEN** a user deletes a note
- **THEN** that note no longer appears in search results

#### Scenario: External file change detected
- **WHEN** a file is modified outside the app and the file watcher detects the change
- **THEN** the FTS5 index is updated to reflect the new content

#### Scenario: Internal write skips disk read
- **WHEN** an internal-write event fires for `notes/foo.md` with content `C`
- **THEN** `SearchService` updates the FTS5 row using `C` directly without calling `storage.read("notes/foo.md")`
- **AND** `indexed_mtime` is set to the disk mtime of the file

#### Scenario: Heal sweep catches dedup miss
- **WHEN** an external write happens to land in the same mtime tick as an internal write and is suppressed by the dedup window
- **AND** the 10-minute heal sweep runs
- **THEN** the sweep observes that the on-disk mtime exceeds `indexed_mtime` and re-indexes the file
