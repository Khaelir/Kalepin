## MODIFIED Requirements

### Requirement: Rewrite links on note rename
The system SHALL update link references across the vault when a note is renamed or moved, including files currently open in editor sessions.

#### Scenario: Wikilink rewriting on rename
- **WHEN** `Meeting Notes.md` is renamed to `Weekly Standup.md`
- **THEN** all notes containing `[[Meeting Notes]]` are updated to `[[Weekly Standup]]`

#### Scenario: Markdown link rewriting on move
- **WHEN** `docs/architecture.md` is moved to `archive/architecture.md`
- **THEN** all notes containing markdown links to the old path have their relative paths recomputed to point to the new location

#### Scenario: Link index updated after rename
- **WHEN** a note is renamed and links are rewritten
- **THEN** the `note_links` table is updated: `target_path` entries pointing to the old path are updated to the new path, and source files that were rewritten are re-indexed

#### Scenario: Rewrite wikilinks in open editor sessions via OT
- **WHEN** a note is renamed and another note that links to it is currently open in an OT editor session
- **THEN** the system SHALL emit an OT operation to replace `[[old name]]` with `[[new name]]` in the open session's document, instead of writing directly to disk
- **AND** the OT operation is applied through the normal OT transform pipeline so concurrent edits are handled correctly

#### Scenario: Mixed open and closed files on rename
- **WHEN** a note is renamed and some linking files are open in editor sessions while others are not
- **THEN** closed files are updated on disk via read-replace-write, and open files are updated via OT operations
- **AND** all affected files are re-indexed after update
