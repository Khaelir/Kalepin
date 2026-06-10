## MODIFIED Requirements

### Requirement: File tree listing
The system SHALL provide an API endpoint that returns the hierarchical file tree of the vault. Every entry in the response (files and directories) SHALL include `mtimeMs` (filesystem last-modified time in milliseconds since epoch) and `birthtimeMs` (filesystem creation time in milliseconds since epoch). When the underlying filesystem reports `birthtime = 0` or otherwise does not support creation time, `birthtimeMs` SHALL fall back to the same value as `mtimeMs`.

#### Scenario: List file tree
- **WHEN** a user requests the file tree
- **THEN** the system returns a recursive listing of all files and directories in the vault, excluding dot-prefixed files (sidecars, `.obsidian/`)

#### Scenario: Entries include modification time
- **WHEN** the file tree response is serialized
- **THEN** every file entry and every directory entry includes a numeric `mtimeMs` field sourced from `fs.stat().mtimeMs`

#### Scenario: Entries include creation time with fallback
- **WHEN** a file has a filesystem-reported `birthtimeMs` greater than zero
- **THEN** the entry's `birthtimeMs` field equals `fs.stat().birthtimeMs`

#### Scenario: Birthtime falls back to mtime on filesystems without creation time
- **WHEN** a file resides on a filesystem where `fs.stat().birthtimeMs` is `0` or not reliably reported
- **THEN** the entry's `birthtimeMs` field equals the entry's `mtimeMs`
