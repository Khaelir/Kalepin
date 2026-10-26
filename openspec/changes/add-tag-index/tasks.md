# Tasks — add tag index

## 1. Parser

- [x] 1.1 `packages/backend/src/tags/tag-parser.ts`: `normalizeTag`, `splitFrontmatter`, `parseFrontmatterTags`, `parseInlineTags`, `parseTags` per design.md "Parsing rules".
- [x] 1.2 `tag-parser.test.ts`: frontmatter shapes (block, flow, multi-line flow, scalar, comma/space separated, quoted, `#`-prefixed, singular `tag:`, comments, unclosed frontmatter, CRLF), inline rules (Unicode, nested, digits-only, code fences, inline code, URLs, link targets, wikilinks, HTML, headings, word-char / `&` / `\` before `#`), dedupe and case folding.

## 2. Storage and index maintenance

- [x] 2.1 `entities/note-tag.entity.ts` (`note_tags`, composite PK `(path, tag)`, index on `tag`); register in `entities/index.ts` and the `app.module.ts` entity list.
- [x] 2.2 `tags/tag-index.service.ts`: `note_tags_meta` table, `indexFile`, `removeFile`, `renamePath` (file + folder prefix), serialised write chain, `isIndexable` (E2E via `ENCRYPTION_PREDICATES`, dot-folders).
- [x] 2.3 Subscriptions: internal writes, shared and personal watcher events, `FilesService` `afterMove` hook, 10-minute heal sweep.
- [x] 2.4 Boot backfill over the shared vault and every personal folder (emails from `users`), skipping `_secure`; triggered by an empty meta table or an outdated `parser_version`.
- [x] 2.5 Queries: `listTags(email)`, `notesForTags(tags, email)`, `pathsWithAllTags(tags)` — visibility via `isVisibleTo` + grant set, E2E filtered.
- [x] 2.6 `tag-index.service.test.ts` (in-memory SQLite): save / change / unlink / internal write, file and folder moves (incl. into `.trash/` and `_secure`), `_secure` never indexed, backfill incl. personal folders, heal sweep, counts with nested tags, display forms, visibility (personal isolation, grants).

## 3. REST API

- [x] 3.1 `tags/tags.controller.ts`: `GET /api/tags`, `GET /api/tags/notes?tag=` (`notes:read`, 400 without `tag`).
- [x] 3.2 `tags/tags.module.ts` (global, imports `FilesModule`, `AuthModule`); add to `app.module.ts`.
- [x] 3.3 Controller test: user email threaded through, missing `tag` rejected.

## 4. Search filter

- [x] 4.1 `tags/tag-query.ts` `parseSearchQuery` + tests.
- [x] 4.2 `SearchService.search`: tag-only listing (cap 100, excerpt, `modifiedAt`) and tag-restricted hybrid search (FTS, comment FTS, vector).
- [x] 4.3 Tests: tag-only ordering, AND semantics, prefix-inclusive, tags + text restriction, visibility in tag-only mode, no-match short-circuit.
- [x] 4.4 Comment FTS: double embedded `"` in query terms, so a quoted term containing `:` (`"tag:x"`) no longer parses as an FTS5 column filter and fails the whole search (pre-existing bug, surfaced by the quote rule).

## 5. MCP

- [x] 5.1 `list_tags` read tool (+ `REGISTERED_TOOLS`), `search_notes` description documents `tag:`.
- [x] 5.2 MCP test: `list_tags` is registered for `ro` keys and returns the caller's visible tags; `search_notes` passes `tag:` queries through, keeps `modifiedAt`, and PIN-locked tagged hits become sentinels (filtering itself is covered by 4.3).

## 6. Frontend

- [x] 6.1 `utils/frontmatter.ts` (`parseFrontmatter` → `{ tags, status }`) + vitest; `InlineTags` and `DocHeader` use it.
- [x] 6.2 `api.ts`: `fetchTags`, `fetchNotesForTag`, `TagCount`; `SearchResult.modifiedAt`.
- [x] 6.3 `utils/tag-tree.ts` (`buildTagTree`) + vitest.
- [x] 6.4 `components/Sidebar/TagsSection.tsx`, wired in `App.tsx` with a refresh key (WS `flushed` / `file:changed` / `file:tree-update`, active file).
- [x] 6.5 `SearchModal` `initialQuery` prop; tag-only results show modified time instead of score; placeholder mentions `tag:`.
- [x] 6.6 Clickable pills in `InlineTags` (TopBar) and `DocHeader` (via `Editor` prop) → `openTagSearch`.
- [x] 6.7 Styles: one `/* ── Tags ── */` block at the end of `styles.css`.

## 7. E2E and verification

- [x] 7.1 (written, not run — shared e2e ports) `packages/e2e/tests/tags.spec.ts`: sidebar tree + counts, click → search modal prefilled and lists tagged notes, top-bar pill click, live refresh after typing a tag, personal tags invisible to another user, `_secure` never surfaces (API).
- [x] 7.2 Backend build + new and neighbouring backend tests; frontend `tsc -b` + `vitest run`.
- [x] 7.3 `openspec validate add-tag-index --strict`.
