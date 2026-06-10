## ADDED Requirements

### Requirement: Parse links from markdown content
The system SHALL extract all inter-note links from markdown content, supporting both wikilink and standard markdown link syntax.

#### Scenario: Parse wikilinks
- **WHEN** a note contains `[[Meeting Notes]]`
- **THEN** the parser extracts a link with type `wikilink` and raw target `Meeting Notes`

#### Scenario: Parse wikilinks with alias
- **WHEN** a note contains `[[Meeting Notes|yesterday's meeting]]`
- **THEN** the parser extracts a link with type `wikilink` and raw target `Meeting Notes` (the alias is ignored for indexing)

#### Scenario: Parse markdown links to local notes
- **WHEN** a note contains `[see here](../docs/architecture.md)`
- **THEN** the parser extracts a link with type `markdown` and raw target `../docs/architecture.md`

#### Scenario: Ignore external URLs
- **WHEN** a note contains `[Google](https://google.com)` or `[[https://example.com]]`
- **THEN** the parser does NOT extract these as inter-note links

#### Scenario: Ignore image embeds
- **WHEN** a note contains `![alt](image.png)` or `![[image.png]]`
- **THEN** the parser does NOT extract these as inter-note links (files without `.md` extension are skipped for markdown links; `![[` prefix is skipped for wikilinks)

### Requirement: Resolve wikilinks to file paths
The system SHALL resolve wikilink targets to actual file paths using shortest-unique-path matching consistent with Obsidian behavior.

#### Scenario: Exact path match
- **WHEN** a wikilink target is `docs/Architecture` and `docs/Architecture.md` exists
- **THEN** the link resolves to `docs/Architecture.md`

#### Scenario: Basename match (unique)
- **WHEN** a wikilink target is `Architecture` and only one file named `Architecture.md` exists in the vault
- **THEN** the link resolves to that file's full path

#### Scenario: Ambiguous basename with same-directory preference
- **WHEN** a wikilink target is `Notes` and multiple files named `Notes.md` exist, and one is in the same directory as the source file
- **THEN** the link resolves to the same-directory file

#### Scenario: Unresolvable wikilink
- **WHEN** a wikilink target does not match any existing file
- **THEN** the link is stored with a null resolved path (dangling link)

### Requirement: Persist link index in SQLite
The system SHALL maintain a `note_links` table storing all parsed links with source path, resolved target path, link type, line number, and surrounding context text.

#### Scenario: Link record structure
- **WHEN** a link is indexed
- **THEN** the record contains `source_path`, `target_path` (nullable), `link_type` ('wikilink' | 'markdown'), `raw_target` (original text), `line_number`, and `context` (the surrounding line of text)

#### Scenario: Index is queryable by target
- **WHEN** a query requests all backlinks for `docs/Architecture.md`
- **THEN** the system returns all records where `target_path = 'docs/Architecture.md'`

#### Scenario: Index is queryable by source
- **WHEN** a query requests all outgoing links from `notes/meeting.md`
- **THEN** the system returns all records where `source_path = 'notes/meeting.md'`

### Requirement: Full vault scan on first boot
The system SHALL perform a complete vault scan and index all links when the `note_links` table is empty.

#### Scenario: First startup
- **WHEN** the server starts and the `note_links` table has no rows
- **THEN** the system scans all `.md` files in the vault, parses links, and populates the index

#### Scenario: Subsequent startup with existing index
- **WHEN** the server starts and the `note_links` table is already populated
- **THEN** the system does NOT perform a full scan, relying on incremental updates from the file watcher

#### Scenario: Startup scan performance
- **WHEN** the vault contains 5000 notes
- **THEN** the full scan completes in under 5 seconds

### Requirement: Incremental re-index on file change
The system SHALL update the link index for a single file when it is created, modified, or deleted, using the existing file watcher.

#### Scenario: File modified
- **WHEN** a `.md` file is modified (content changes detected by file watcher)
- **THEN** the system deletes all link records where `source_path` equals the changed file, re-parses the file's content, and inserts new link records

#### Scenario: File deleted
- **WHEN** a `.md` file is deleted
- **THEN** the system deletes all link records where `source_path` equals the deleted file

#### Scenario: File created
- **WHEN** a new `.md` file is created
- **THEN** the system parses the file's content and inserts link records

### Requirement: Rewrite links on note rename
The system SHALL update link references across the vault when a note is renamed or moved.

#### Scenario: Wikilink rewriting on rename
- **WHEN** `Meeting Notes.md` is renamed to `Weekly Standup.md`
- **THEN** all notes containing `[[Meeting Notes]]` are updated to `[[Weekly Standup]]`

#### Scenario: Markdown link rewriting on move
- **WHEN** `docs/architecture.md` is moved to `archive/architecture.md`
- **THEN** all notes containing markdown links to the old path have their relative paths recomputed to point to the new location

#### Scenario: Link index updated after rename
- **WHEN** a note is renamed and links are rewritten
- **THEN** the `note_links` table is updated: `target_path` entries pointing to the old path are updated to the new path, and source files that were rewritten are re-indexed

### Requirement: Query backlinks with context
The system SHALL provide an API endpoint to retrieve all notes linking to a given path, including context snippets.

#### Scenario: Fetch backlinks
- **WHEN** a client sends `GET /api/links/backlinks?path=docs/Architecture.md`
- **THEN** the system returns an array of backlink entries, each containing `sourcePath`, `lineNumber`, `context` (the line containing the link), and `linkType`

#### Scenario: No backlinks exist
- **WHEN** a client requests backlinks for a note with no incoming links
- **THEN** the system returns an empty array

### Requirement: Query outgoing links
The system SHALL provide an API endpoint to retrieve all links from a given note.

#### Scenario: Fetch outgoing links
- **WHEN** a client sends `GET /api/links/outgoing?path=notes/meeting.md`
- **THEN** the system returns an array of outgoing link entries, each containing `targetPath`, `rawTarget`, `lineNumber`, and `linkType`

### Requirement: Query unlinked mentions
The system SHALL provide an API endpoint to find notes that mention the current note's title as plain text without an explicit link.

#### Scenario: Find unlinked mentions
- **WHEN** a client sends `GET /api/links/unlinked-mentions?path=docs/Architecture.md`
- **THEN** the system searches for notes containing the word "Architecture" (the note's title derived from filename), excludes notes that already have a link to `docs/Architecture.md` in the index, and returns matches with context snippets

#### Scenario: No unlinked mentions
- **WHEN** no other note mentions the current note's title without a link
- **THEN** the system returns an empty array

### Requirement: Convert unlinked mention to wikilink
The system SHALL provide an API endpoint to convert a plain-text mention into a wikilink.

#### Scenario: Convert mention
- **WHEN** a client sends `POST /api/links/convert-mention` with `{ sourcePath, lineNumber, title }`
- **THEN** the system reads the source file, replaces the first occurrence of `title` on the specified line with `[[title]]`, writes the file, and the link index updates via the file watcher
