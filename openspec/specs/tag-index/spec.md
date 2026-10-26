# tag-index Specification

## Purpose
TBD - created by archiving change add-tag-index. Update Purpose after archive.
## Requirements
### Requirement: Parse tags from frontmatter

The system SHALL read tags from the YAML frontmatter keys `tags` and `tag` (case-insensitive, top-level). The value MAY be a block list, a flow list (on one or several lines), or a scalar holding one tag or several tags separated by commas and/or whitespace. Surrounding quotes and a leading `#` SHALL be stripped from each tag. Frontmatter SHALL only be recognised when the first line of the note is `---` and a closing `---` or `...` line exists.

#### Scenario: Block list
- **WHEN** a note starts with `---\ntags:\n  - project\n  - idea\n---`
- **THEN** the note's tags are `project` and `idea`

#### Scenario: Flow list with quotes and hashes
- **WHEN** a note's frontmatter contains `tags: [alpha, "beta", '#gamma']`
- **THEN** the note's tags are `alpha`, `beta` and `gamma`

#### Scenario: Scalar string
- **WHEN** a note's frontmatter contains `tags: one, two three`
- **THEN** the note's tags are `one`, `two` and `three`

#### Scenario: Singular key
- **WHEN** a note's frontmatter contains `tag: meeting`
- **THEN** the note's tags include `meeting`

#### Scenario: YAML comment is not a tag
- **WHEN** a note's frontmatter contains `tags: work # quarterly`
- **THEN** the note's tags are `work` only

#### Scenario: Unclosed frontmatter
- **WHEN** a note starts with `---\ntags: x` and has no closing `---`
- **THEN** no frontmatter tags are read

### Requirement: Parse inline tags from the body

The system SHALL read inline tags from the note body following Obsidian's rules: `#` followed by Unicode letters, digits, `_`, `-` or `/`; at least one character that is not a digit; not preceded by a letter, digit, `_`, `#`, `&`, `/` or `\`; not inside a fenced code block or an inline code span; not part of a URL, a markdown link destination, a wikilink or an HTML tag. A `#` followed by a space (a heading marker) SHALL NOT start a tag.

#### Scenario: Inline and nested tags
- **WHEN** a note body contains `Planning #project/kalepin and #café`
- **THEN** the note's tags are `project/kalepin` and `café`

#### Scenario: Digits-only is not a tag
- **WHEN** a note body contains `issue #1984`
- **THEN** no tag is read

#### Scenario: Code is ignored
- **WHEN** a note body contains `` `#notatag` `` and a fenced block containing `#alsonot`
- **THEN** no tag is read

#### Scenario: Links and URLs are ignored
- **WHEN** a note body contains `https://example.com/#frag`, `[x](#anchor)` and `[[#Heading]]`
- **THEN** no tag is read

#### Scenario: Headings and word-attached hashes are ignored
- **WHEN** a note body contains `# Title`, `## Sub` and `C#`
- **THEN** no tag is read

### Requirement: Tags are case-insensitive

The system SHALL match tags case-insensitively by storing a lowercase key per tag, and SHALL keep the casing as written for display. When notes disagree on casing, the displayed form SHALL be the most frequent one (ties broken by code-point order).

#### Scenario: Mixed casing counts once
- **GIVEN** note A has `#Project` and note B has `#project`
- **WHEN** the tag list is requested
- **THEN** a single entry for the tag is returned with a count of 2

### Requirement: Persist the tag index

The system SHALL keep a `note_tags` table of `(path, tag, display)` rows, one per distinct tag per note, and a `note_tags_meta` table recording when each note was last indexed and with which parser version.

#### Scenario: Index rows for a tagged note
- **WHEN** `Notes/a.md` containing `#x` and frontmatter `tags: [Y]` is indexed
- **THEN** `note_tags` holds `(Notes/a.md, x, x)` and `(Notes/a.md, y, Y)`

### Requirement: Keep the tag index in sync with the vault

The system SHALL update the tag index on every internal write (editor save / OT flush, REST and MCP writes), on shared and personal watcher `add`, `change` and `unlink` events, on `FilesService.move` for files and folders, through a periodic heal sweep, and through a boot-time backfill over the shared vault and every personal folder when the index is empty or was built by an older parser version.

#### Scenario: Save updates tags
- **GIVEN** `Notes/a.md` has the tag `old`
- **WHEN** the note is saved with `#new` instead
- **THEN** the index holds `new` and not `old` for `Notes/a.md`

#### Scenario: Delete drops rows
- **WHEN** the watcher reports `unlink` for `Notes/a.md` (including a move into `.trash/`)
- **THEN** no `note_tags` or `note_tags_meta` row remains for `Notes/a.md`

#### Scenario: Folder move rewrites paths
- **GIVEN** `Projects/a.md` and `Projects/sub/b.md` are tagged
- **WHEN** the folder `Projects` is moved to `Archive/Projects`
- **THEN** their rows now carry `Archive/Projects/a.md` and `Archive/Projects/sub/b.md`

#### Scenario: Existing vault is backfilled
- **GIVEN** an existing vault with tagged notes in the shared vault and in personal folders, and an empty tag index
- **WHEN** the backend boots
- **THEN** every non-E2E note is indexed

### Requirement: End-to-end encrypted notes are never indexed

The system SHALL NOT read or index paths under `_users/{email}/_secure/` (nor paths inside dot-folders). Writes to such paths SHALL purge any existing rows, a move into them SHALL drop the moved rows, and query results SHALL exclude them.

#### Scenario: Secure note write
- **WHEN** an internal write or watcher event arrives for `_users/alice@example.com/_secure/diary.md`
- **THEN** no `note_tags` row exists for that path

#### Scenario: Backfill skips secure folders
- **WHEN** the boot backfill walks Alice's personal folder
- **THEN** nothing under `_users/alice@example.com/_secure/` is read

### Requirement: List tags visible to the caller

The system SHALL expose `GET /api/tags` returning `[{ tag, count }]` sorted by tag, where `count` is the number of distinct notes visible to the caller (shared vault, the caller's own personal folder, and paths granted to the caller) that carry the tag or any nested child tag (`project/kalepin` counts toward `project`).

#### Scenario: Nested counts
- **GIVEN** visible notes A (`#project`), B (`#project/kalepin`) and C (`#project/kalepin`, `#project`)
- **WHEN** the caller requests `GET /api/tags`
- **THEN** the response contains `{ tag: 'project', count: 3 }` and `{ tag: 'project/kalepin', count: 2 }`

#### Scenario: Personal tags are isolated
- **GIVEN** only Alice's personal note `_users/alice@example.com/x.md` has the tag `secret-plan`
- **WHEN** Bob requests `GET /api/tags`
- **THEN** no entry for `secret-plan` is returned
- **AND** when Alice requests it, `{ tag: 'secret-plan', count: 1 }` is returned

#### Scenario: Granted note counts for the grantee
- **GIVEN** Alice granted Bob read access to `_users/alice@example.com/shared.md` tagged `#review`
- **WHEN** Bob requests `GET /api/tags`
- **THEN** the response contains `{ tag: 'review', count: 1 }`

### Requirement: List notes carrying a tag

The system SHALL expose `GET /api/tags/notes?tag=<tag>` returning `[{ path, title, modifiedAt }]` for the notes visible to the caller that carry the tag or any `<tag>/…` child, case-insensitively, most recently modified first. A request without `tag` SHALL be rejected with 400.

#### Scenario: Prefix-inclusive lookup
- **GIVEN** visible notes tagged `project` and `project/kalepin`, and one tagged `projects`
- **WHEN** the caller requests `GET /api/tags/notes?tag=Project`
- **THEN** the first two notes are returned and the `projects` note is not

#### Scenario: Foreign personal note is not listed
- **GIVEN** Alice's personal note carries `#plan`
- **WHEN** Bob requests `GET /api/tags/notes?tag=plan`
- **THEN** Alice's note is not in the response

### Requirement: MCP list_tags tool

The MCP server SHALL register a read-only `list_tags` tool, for every API-key scope, returning the same JSON array as `GET /api/tags` for the calling user.

#### Scenario: Agent lists tags
- **WHEN** an MCP client calls `list_tags`
- **THEN** the result text is a JSON array of `{ tag, count }` computed over the notes visible to the key's user

