## 1. Data Layer — Link Index Table

- [x] 1.1 Create `NoteLink` entity (`note_links` table) with columns: `id`, `source_path`, `target_path` (nullable), `raw_target`, `link_type` ('wikilink' | 'markdown'), `line_number`, `context` (text). Add indexes on `source_path` and `target_path`
- [x] 1.2 Register the entity in the app module and run migration/sync

## 2. Link Parser

- [x] 2.1 Implement `parseLinksfromMarkdown(content, sourcePath)` — regex-based parser that extracts wikilinks (`[[...]]`, excluding `![[`) and markdown links (`[text](path.md)`, excluding `![`, excluding external URLs)
- [x] 2.2 Implement wikilink resolution: `resolveWikilink(rawTarget, sourcePath, allPaths)` — shortest-unique-path matching (exact path → unique basename → same-directory preference)
- [x] 2.3 Unit test the parser against edge cases: aliases, external URLs, image embeds, ambiguous basenames, nested brackets

## 3. Link Index Service

- [x] 3.1 Create `LinkIndexService` with `indexFile(path, content)` — parse links, resolve targets, delete-and-reinsert records for that source path
- [x] 3.2 Implement `fullScan()` — read all `.md` files from storage, index each one. Run on startup if the `note_links` table is empty
- [x] 3.3 Subscribe to `FileWatcherService.onFileChange()` for incremental re-indexing (create → index, modify → re-index, delete → remove records)
- [x] 3.4 Implement `getBacklinks(path)` — query `WHERE target_path = path`, join with context
- [x] 3.5 Implement `getOutgoingLinks(path)` — query `WHERE source_path = path`
- [x] 3.6 Implement `getUnlinkedMentions(path)` — derive title from filename, query FTS5 for matches, filter out notes that already have a link in the index, post-filter for contiguous phrase match
- [x] 3.7 Implement `convertMention(sourcePath, lineNumber, title)` — read file, replace first occurrence of title on the given line with `[[title]]`, write file back

## 4. Rename-Aware Link Rewriting

- [x] 4.1 Implement `rewriteLinksOnRename(oldPath, newPath)` in `LinkIndexService` — query all notes linking to `oldPath`, rewrite wikilinks (update basename) and markdown links (recompute relative paths) in each source file
- [x] 4.2 Integrate with `FilesService.move()` — call `rewriteLinksOnRename` after the file move and sidecar move, before attachment path rewriting
- [x] 4.3 Update `target_path` entries in `note_links` from old path to new path after rename

## 5. API Endpoints

- [x] 5.1 Create `LinksController` with `GET /api/links/backlinks?path=...` — returns backlink entries with source path, context, line number, link type
- [x] 5.2 Add `GET /api/links/outgoing?path=...` — returns outgoing link entries
- [x] 5.3 Add `GET /api/links/unlinked-mentions?path=...` — returns unlinked mention entries with context
- [x] 5.4 Add `POST /api/links/convert-mention` (body: `{ sourcePath, lineNumber, title }`) — triggers mention conversion
- [x] 5.5 Create `LinksModule` registering the controller, service, and entity. Add auth guards to all endpoints

## 6. Frontend — Backlinks Panel

- [x] 6.1 Add API client functions: `fetchBacklinks(path)`, `fetchOutgoingLinks(path)`, `fetchUnlinkedMentions(path)`, `convertMention(sourcePath, lineNumber, title)`
- [x] 6.2 Create `BacklinksPanel` component with three collapsible sections: Backlinks, Outgoing Links, Unlinked Mentions. Each entry shows note title, context snippet, and is clickable to navigate
- [x] 6.3 Add backlinks toolbar button (link icon) with badge showing backlink count, wired to toggle the panel
- [x] 6.4 Implement sidebar panel management — backlinks replaces other panels (comments, version history) when opened
- [x] 6.5 Add "Link" button on unlinked mention entries, wired to `convertMention` API. Move the entry to backlinks section on success
- [x] 6.6 Refresh panel content when the user navigates to a different note
