# First-class, Obsidian-compatible tags

## Why

Notes already carry tags — YAML frontmatter `tags:` and inline `#tag` in the body, exactly as Obsidian writes them — but Kalepin only reads them in the browser, for display. Two duplicated `parseFrontmatter` copies (`TopBar/InlineTags.tsx`, `editor/DocHeader.tsx`) render the frontmatter tags as pills, and neither understands YAML block lists. Nothing on the server knows about tags, so there is no tag list, no "notes tagged X", no way to narrow a search to a tag, and an MCP agent cannot discover how the vault is organised.

## What Changes

- **Tag parser (backend).** One parser for both sources, following Obsidian's rules: frontmatter `tags:` / `tag:` as a block list, a flow list (`[a, b]`), or a single, comma- or space-separated string, with a leading `#` stripped; inline `#tag` made of Unicode letters, digits, `_`, `-`, `/`, with at least one non-digit, not inside fenced or inline code, not part of a URL, link target or wikilink, not a heading marker and not preceded by a word character. Matching is case-insensitive (lowercase key, original casing kept for display).
- **Tag index.** New `note_tags (path, tag, display)` table plus a `note_tags_meta` freshness table, maintained by the same pipeline as the link index: internal writes (saves, OT flushes, MCP writes), shared and personal watcher `add`/`change`/`unlink`, `FilesService.move` (file and folder moves), a periodic heal sweep, and a boot-time backfill over the shared vault and every personal folder so existing vaults get indexed. `_users/{email}/_secure/…` (E2E) and dot-folders (e.g. `.trash/`) are never indexed; delete drops rows.
- **REST API.** `GET /api/tags` → `[{ tag, count }]` over the notes visible to the caller (nested tags also count toward their parents); `GET /api/tags/notes?tag=x` → visible notes carrying `x` or any `x/…` child, as `{ path, title, modifiedAt }`, most recently modified first.
- **Search filter.** A `tag:x` token in a search query (REST search and MCP `search_notes` — both go through `SearchService.search`) restricts results to notes carrying `x` or a child of `x`. Several `tag:` tokens are ANDed. A query made only of `tag:` tokens lists the tagged notes, most recently modified first.
- **MCP.** New read tool `list_tags` (registered for every scope, like the other read tools). `search_notes` documents the `tag:` filter.
- **UI.** A collapsible "Tags" sidebar section shows the tag tree with counts and refreshes as notes change. Clicking a tag — in the sidebar or a tag pill in the top bar / doc header — opens the search modal prefilled with `tag:<name>`. The two `parseFrontmatter` copies are replaced by one util (`utils/frontmatter.ts`) that also understands block lists.

Out of scope: renaming a tag across notes; tag autocomplete in the editor.

## Capabilities

### New Capabilities

- `tag-index`: parsing tags from markdown, the `note_tags` index and its maintenance, the `/api/tags` endpoints and the MCP `list_tags` tool.
- `tags-ui`: the sidebar Tags section, clickable tag pills, and opening the search modal with an initial `tag:` query.

### Modified Capabilities

- `full-text-search`: `tag:` filter tokens in search queries.
- `mcp-search-notes`: `search_notes` honours and documents the `tag:` filter.
- `mcp-tool-registration`: `list_tags` joins the always-registered read tools.

## Impact

- **Backend**
  - `packages/backend/src/tags/` (new): `tag-parser.ts`, `tag-query.ts`, `tag-index.service.ts`, `tags.controller.ts`, `tags.module.ts`, tests.
  - `packages/backend/src/entities/note-tag.entity.ts` (new) — registered in `entities/index.ts` and `app.module.ts`.
  - `packages/backend/src/search/search.service.ts` — parses `tag:` tokens; restricts FTS / comment FTS / vector candidates to tagged paths; tag-only listing.
  - `packages/backend/src/mcp/mcp.service.ts` — `list_tags` tool; `search_notes` description.
- **Frontend**
  - `utils/frontmatter.ts` (new, shared by `InlineTags` and `DocHeader`), `utils/tag-tree.ts` (new).
  - `components/Sidebar/TagsSection.tsx` (new); `SearchModal.tsx` (`initialQuery`, tag-only rendering); `TopBar`, `InlineTags`, `DocHeader`, `Editor` (click handler plumbing); `App.tsx` (wiring); `api.ts` (`fetchTags`, `fetchNotesForTag`); `styles.css` (one `/* ── Tags ── */` block).
- **E2E**: `packages/e2e/tests/tags.spec.ts`.
- **Data**: two new SQLite tables. First boot after upgrade reads every non-E2E note once to backfill the index (the link index does the same on an empty table).
- **Risk**: tag counts are computed in memory from all visible rows on each `/api/tags` call; fine at the vault sizes Kalepin targets (thousands of notes), revisit with SQL aggregation if it shows up in profiles.
