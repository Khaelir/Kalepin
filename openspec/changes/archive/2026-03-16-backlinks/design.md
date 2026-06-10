## Context

Kalepin notes are markdown files on disk. Users link between notes using two syntaxes:
- **Wikilinks**: `[[Note Title]]` or `[[path/to/note]]` (Obsidian-compatible, resolved by title or path)
- **Markdown links**: `[text](relative/path.md)` (standard markdown, resolved by relative path)

Currently, no system tracks these links. The search infrastructure (FTS5 + ONNX embeddings) indexes content but not link structure. The `FileWatcherService` already broadcasts file change events to subscribers (used by search indexing and change tracking), providing a natural hook for incremental link indexing.

When notes are renamed via `FilesService.move()`, attachment paths are rewritten, but link references in other documents are not updated.

## Goals / Non-Goals

**Goals:**
- Parse and index all inter-note links across the vault
- Provide fast backlinks/outgoing links queries (<50ms for vaults up to 5000 notes)
- Update the index incrementally on file changes (no full re-scan needed)
- Rewrite links across the vault when a note is renamed or moved
- Surface unlinked mentions (title matches without an explicit link)
- Provide a backlinks panel in the editor UI

**Non-Goals:**
- Visual graph view (force-directed graph rendering) — high effort, low incremental value over the backlinks panel; can be added later on top of the same index
- Block-level transclusion (`![[embed]]` syntax) — different feature, different complexity
- Cross-vault links — Kalepin operates on a single vault
- Link validation / broken link detection — useful but separate concern
- Heading/block-level anchors (`[[note#heading]]`) — v1 resolves at the note level only

## Decisions

### 1. SQLite table over in-memory graph

**Decision**: Store the link index in a `note_links` SQLite table rather than an in-memory data structure.

**Alternatives considered**:
- *In-memory Map/Set*: Faster queries, but lost on restart (requires full re-scan), doesn't scale well with vault size, and can't be queried from other services.
- *Separate graph database*: Overkill for a link index with simple edge queries.

**Rationale**: SQLite is already the database. A table with proper indexes gives O(1) startup (no re-scan if data is persisted), standard SQL queries, and consistency with the rest of the data model. Full re-scan only needed on first boot or schema migration.

### 2. Wikilink resolution strategy

**Decision**: Resolve `[[wikilinks]]` using a shortest-unique-path match, consistent with Obsidian's behavior.

Resolution order:
1. Exact path match (with or without `.md` extension)
2. Filename match (basename without extension) — if unique across the vault, it resolves
3. If ambiguous (multiple files with same basename), prefer the file in the same directory as the source

**Alternatives considered**:
- *Exact path only*: Too strict — most users write `[[Meeting Notes]]` not `[[work/meetings/Meeting Notes.md]]`
- *First match*: Non-deterministic, confusing when files move

**Rationale**: Matching Obsidian's resolution behavior ensures consistency for users who use both clients.

### 3. Incremental re-indexing via file watcher

**Decision**: Subscribe to `FileWatcherService.onFileChange()` to re-index a single file's links when it changes. On file change: delete all links where `source_path = changed_file`, re-parse, insert new links.

**Alternatives considered**:
- *Debounced batch re-index*: Adds complexity, marginal benefit since single-file re-index is fast (~<10ms)
- *Diff-based link update*: Compute which links changed and update only those. More complex, saves few writes.

**Rationale**: Delete-and-reinsert for a single file is simple, fast, and correct. SQLite handles small writes efficiently. The file watcher already exists and is used by search indexing and change tracking.

### 4. Full vault scan on first boot only

**Decision**: On startup, check if the `note_links` table is populated. If empty (first boot or schema migration), do a full vault scan. Otherwise, trust the persisted index and rely on the file watcher for updates.

**Rationale**: Avoids the O(N) startup cost on every restart. External edits between restarts (e.g., Obsidian editing while Kalepin is down) are caught by chokidar's initial scan which fires change events for modified files.

### 5. Rename link rewriting in FilesService.move()

**Decision**: When a note is renamed/moved, query all notes that link to it (`target_path = old_path`) and rewrite the link syntax in each source file. Update the link index accordingly.

This extends the existing `rewriteAttachmentPaths` pattern in `FilesService.move()`.

**Link rewriting rules**:
- `[[Old Title]]` → `[[New Title]]` (wikilinks use the target's new basename without extension)
- `[text](../old/path.md)` → `[text](../new/path.md)` (markdown links recompute relative path from source to new target)

**Alternatives considered**:
- *Don't rewrite, just update the index*: Leaves broken links in documents. Users would have to fix them manually.
- *Only rewrite wikilinks*: Inconsistent — markdown links would break silently.

**Rationale**: Link rewriting is what Obsidian does and what users expect. The index makes it efficient — no need to scan every file, just query `WHERE target_path = old_path`.

### 6. Unlinked mentions via FTS5

**Decision**: Use the existing `notes_fts` FTS5 table to find unlinked mentions. Query for notes matching the current note's title, then filter out notes that already have an explicit link in the index.

**Alternatives considered**:
- *Separate regex scan of all files*: O(N) on vault size, slow for large vaults.
- *Dedicated mentions table*: Requires keeping another index in sync.

**Rationale**: FTS5 already indexes all note content and handles tokenization. A `MATCH` query for the note title is fast and requires no additional infrastructure.

### 7. Backlinks panel as a sidebar (same pattern as comments)

**Decision**: The backlinks panel opens as a right sidebar, following the same pattern as the existing `CommentsPanel`. Only one sidebar panel is visible at a time.

**Rationale**: Consistent UX pattern. Users already understand the sidebar interaction model.

## Risks / Trade-offs

**[Wikilink ambiguity]** → When multiple files share the same basename, resolution may not match the user's intent. Mitigation: prefer same-directory matches; in the UI, show the full path on hover for backlinks so users can verify.

**[Rename rewriting side effects]** → Rewriting links in other files modifies their content, which triggers change tracking entries and OT operations for those files. Mitigation: batch the rewrites and attribute them to the user who initiated the rename. This is the same behavior Obsidian has — it's expected.

**[Startup scan performance]** → First boot on a 5000-note vault requires parsing all files. Mitigation: the parser is simple regex (not full markdown AST), and we only extract links — expect <5s for 5000 files. Run async after module init to avoid blocking the server.

**[Stale index after external edits while server is down]** → If files are edited externally while Kalepin is not running, the index may be stale. Mitigation: chokidar fires `add`/`change` events on startup for files modified since the watcher was last active, triggering incremental re-index.

**[FTS tokenization mismatch for unlinked mentions]** → FTS5 tokenizes differently than exact title matching (e.g., "API Design" might match "api" and "design" independently). Mitigation: post-filter FTS results with a case-insensitive substring check on the actual content to confirm the title appears as a contiguous phrase.
