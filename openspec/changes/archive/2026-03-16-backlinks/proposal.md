## Why

Kalepin stores a collection of interconnected markdown notes, but the connections are invisible. Users write `[[wikilinks]]` and `[text](path.md)` links between notes, yet there's no way to discover what links *to* the current note. Without backlinks, each note is an island — users must remember relationships manually. Backlinks are what turn a note collection into a knowledge graph, and they're the single most requested feature in tools like Obsidian, Roam, and Logseq. Surfacing them in Kalepin's web UI means users get the "connected thinking" experience without needing the desktop app.

## What Changes

- New **link index** in SQLite that tracks all outgoing links from every note (both `[[wikilinks]]` and `[text](path.md)` markdown links)
- Index is built on startup by scanning all `.md` files and **updated incrementally** via the existing chokidar file watcher
- New **backlinks panel** in the editor sidebar showing all notes that link to the currently open note, with surrounding context snippets
- **Outgoing links** section in the same panel showing what the current note links to
- **Unlinked mentions** — notes that mention the current note's title as plain text without an explicit link, with a one-click action to convert the mention to a `[[wikilink]]`
- **Rename-aware link updates** — when a note is renamed/moved, all `[[wikilinks]]` and relative markdown links pointing to it are rewritten across the vault

## Capabilities

### New Capabilities
- `link-index`: Backend service that parses links from markdown, maintains a SQLite link graph, and provides query APIs for backlinks, outgoing links, and unlinked mentions
- `backlinks-ui`: Editor sidebar panel displaying backlinks, outgoing links, and unlinked mentions with context snippets and conversion actions

### Modified Capabilities

## Impact

- **Backend**: New `LinkIndexService` and `LinksController`, new `note_links` SQLite table, integration with `FileWatcherService` for incremental updates, integration with `FilesService.move()` for rename-aware link rewriting
- **Frontend**: New `BacklinksPanel` component, toolbar button, API client functions
- **Database**: New `note_links` table (source_path, target_path, link_type, line_number, context)
- **API**: New `GET /api/links/backlinks?path=...`, `GET /api/links/outgoing?path=...`, `GET /api/links/unlinked-mentions?path=...`, `POST /api/links/convert-mention`
- **Performance**: Full vault scan on startup (~5000 notes in <5s target), incremental single-file re-index on change (~<50ms)
