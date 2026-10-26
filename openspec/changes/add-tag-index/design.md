# Design — tag index

## Goal

Make the tags users already write (frontmatter and inline, Obsidian-style) queryable on the server: list them, list the notes carrying one, and narrow a search to one — without ever reading E2E content and without showing anyone a tag from a note they cannot see.

## Parsing rules

One parser, `backend/src/tags/tag-parser.ts`, returns `{ tag, display }[]` deduplicated by `tag` (first occurrence wins, frontmatter before body).

### Normalisation

- `display` is the tag as written, minus the leading `#`, with empty `/` segments dropped (`a//b/` → `a/b`) and NFC-normalised.
- `tag` (the key) is `display.toLowerCase()`. All matching is on the key, so `#Project` and `#project` are the same tag.
- A tag is valid iff it is made of Unicode letters, combining marks, numbers, `_`, `-`, `/`; contains at least one character that is not a number (`#1984` is not a tag, `#y1984` and `#2024-q1` are); and contains at least one letter or number (`#-`, `#__` are not tags).

### Frontmatter

- Frontmatter is recognised only when the first line is `---`; it ends at the next `---` or `...` line. No closing line → no frontmatter (the whole file is body).
- Keys `tags` and `tag` (case-insensitive, top-level, i.e. not indented) are read. Accepted value shapes:
  - flow list `tags: [a, "b", '#c']`, also spread over several lines until the closing `]`;
  - block list `tags:` followed by `- a` / `  - a` lines (blank lines and `#`-comment lines inside the list are skipped; the list ends at the first other line);
  - scalar `tags: a`, `tags: a, b`, `tags: a b`, `tags: "#a"`.
- Each item is unquoted, then split on commas and whitespace, then each piece has its leading `#` stripped and is validated with the rules above. Invalid pieces are dropped silently. A list item containing a space therefore yields two tags (Obsidian does not allow spaces in tags).
- YAML comments: ` # …` (a `#` followed by whitespace or end of line) starts a comment and is dropped; `#foo` (hash glued to a tag character) is read as the tag `foo` because Obsidian users routinely write `tags: #foo`.
- Block scalars (`|`, `>`) and anchors are not supported (no tags read).

### Inline (body)

The body is the content after the frontmatter. A tag is `#` followed by tag characters, read greedily, then validated. A candidate is skipped when:

- it is inside a fenced code block (```` ``` ```` or `~~~`, up to three spaces of indent; the fence closes on the same character with at least as many markers);
- it is inside an inline code span (backtick runs of matching length);
- it is part of a URL (`scheme://…`, `www.…`), a markdown link destination `](…)`, a wikilink `[[…]]` (so `[[#Heading]]` is a link, not a tag) or an HTML tag `<a href="#x">`;
- the `#` is preceded by a letter, number, `_`, `#`, `&`, `/` or `\` (covers `abc#tag`, `C#`, `##`, `&#39;`, `/#anchor`, escaped `\#tag`);
- it is a heading marker: `# Heading` never matches because the `#` is followed by a space; `## H` is skipped by the `#`-before-`#` rule. `#Heading` without a space is a tag, as in Obsidian.

Not handled (documented limits): indented (4-space) code blocks — they are indistinguishable from list continuations without a full CommonMark parse; Obsidian `%% comments %%`; math blocks.

### Frontend copy

`@kalepin/shared` is types-only today (the backend cannot `require` TypeScript at runtime), so the frontmatter half of the parser is duplicated in `frontend/src/utils/frontmatter.ts` with the same rules and its own vitest suite. It replaces the two divergent `parseFrontmatter` copies and additionally returns `status` (used by the pills). Header pills keep showing **frontmatter tags only**: inline tags are already visible in the body, and pulling them into the pill row would duplicate them and make the row unbounded. Both pill rows become clickable.

## Storage

```sql
-- TypeORM entity NoteTag (synchronize: true)
CREATE TABLE note_tags (
  path    VARCHAR NOT NULL,
  tag     VARCHAR NOT NULL,   -- lowercase key
  display VARCHAR NOT NULL,   -- as written in this note
  PRIMARY KEY (path, tag)
);
CREATE INDEX ... ON note_tags(tag);

-- raw SQL, mirrors note_links_meta
CREATE TABLE note_tags_meta (
  path           TEXT PRIMARY KEY,
  indexed_mtime  INTEGER,       -- disk mtime when last indexed
  parser_version INTEGER
);
```

- Only the literal tag is stored (`project/kalepin`, not also `project`). Ancestors are expanded at query time; prefix filters use `tag = ? OR tag LIKE ? || '/%' ESCAPE '\'` with the value passed through `escapeLike`.
- Every indexed note gets a meta row, tagged or not, so the heal sweep can detect drift and `modifiedAt` can be served without touching the disk.
- `parser_version` lets a parser change trigger a one-off rescan at boot (see Backfill).
- Display form of an aggregate tag: the most frequent `display` among the rows (and, for an ancestor, among the matching prefixes of child rows); ties go to the code-point-smallest form. This is deterministic across re-indexes, unlike "first seen", which would shift every time a note is re-saved (rows are deleted and re-inserted).

## Maintenance

`TagIndexService` mirrors `LinkIndexService`:

| Trigger | Action |
|---|---|
| `FileWatcherService.onInternalWrite` (FilesService writes, OT flush, MCP writes) | index from the in-memory content |
| shared `onFileChange` and personal `onPersonalChange`: `add` / `change` | read + index |
| `unlink` (also covers `.trash/` moves, which the watcher sees as unlinks) | drop rows + meta |
| `FilesService.move` `afterMove` hook | rewrite `path` for the file or the folder prefix; drop instead when the destination is not indexable (E2E, dot-folder); re-read a moved `.md` file so a note moved out of a non-indexed location gets indexed |
| heal sweep every 10 min | re-index rows whose disk mtime moved past `indexed_mtime`; drop `ENOENT` paths |
| boot | full scan when `note_tags_meta` is empty or holds a row from an older `parser_version` |

The link index only subscribes to shared-vault watcher events; the tag index also subscribes to personal events, as the search index does, so external edits in a personal folder are picked up.

**Indexable path**: ends in `.md`, `predicates.shouldIndexPlaintext(path)` (false for `_users/{email}/_secure/…`), and no segment starting with `.`. Non-indexable paths are purged rather than skipped, so a path that becomes E2E leaves nothing behind.

**Serialisation**: every write (index, remove, move) goes through one promise chain. `indexFile` is a `DELETE` + `INSERT`; two overlapping calls for the same path (internal write + a late watcher event) could otherwise interleave and leave a stale union. SQLite serialises writes anyway, so the chain costs nothing measurable.

**Backfill**: the scan walks `storage.list('')` (shared vault) plus `storage.list('_users/{email}')` for every row of `users` — `storage.list('')` never descends into personal folders. Folders named `_secure` directly under a personal root are skipped before any read, so envelope bytes are never fetched. The scan is awaited in `onModuleInit`, like the link index's.

## Visibility

Rows are stored namespace-blind (as FTS rows are) and filtered at query time with the same predicate the link index uses for backlinks and the graph: `isVisibleTo(path, email) || grants.has(path)` where `grants = GrantAwareVisibility.visibleGrantSet(email)`. E2E paths are additionally filtered at query time as defence in depth. Counts are therefore computed over visible notes only: Bob never sees a tag that only exists in Alice's personal notes, nor an inflated count.

PIN-locked notes are not special-cased: their tags count and they are listed by path/title, as they are in the file tree. Text content of PIN-locked notes is gated exactly as before (MCP `search_notes` turns any PIN-locked hit, including tag-only hits, into its `pin-protected` sentinel).

## API

- `GET /api/tags` (`notes:read`) → `[{ tag, count }]`, sorted by key. `tag` is the display form; `count` is the number of distinct visible notes carrying the tag or any descendant.
- `GET /api/tags/notes?tag=x` (`notes:read`) → `[{ path, title, modifiedAt }]` for visible notes carrying `x` or `x/…`, `modifiedAt` desc then path. `title` is the file name without `.md` (the same title the doc header shows). Missing `tag` → 400.
- MCP `list_tags` → the same JSON array as `GET /api/tags`. Read tool: registered for every scope, `readOnlyHint: true`, no arguments.

## Search filter

`parseSearchQuery(query)` (`backend/src/tags/tag-query.ts`) splits a query into `{ text, tags }`:

- a token is `tag:<value>` (case-insensitive prefix), delimited by whitespace; `<value>` may start with `#`; it is lowercased, NFC-normalised and trailing `/` dropped;
- tokens inside double quotes stay text (`"tag:x"` searches for the phrase);
- an empty `tag:` is dropped;
- duplicates are removed; multiple tags are ANDed.

`SearchService.search` is the only consumer, so REST search and MCP `search_notes` share it.

- **Tags + text**: `TagIndexService.pathsWithAllTags(tags)` gives the candidate set (prefix-inclusive, intersection across tags). The usual hybrid pipeline runs on `text` only, with the set threaded into note FTS and comment FTS as `AND path IN (SELECT value FROM json_each(?))` (one JSON parameter, no variable-count limit) and into the vector loop as a `Set` check before the cosine. Filtering inside the queries, not after them, keeps tagged notes that would rank below the FTS `LIMIT 50` of an unfiltered query. Visibility clauses are unchanged.
- **Tags only**: `TagIndexService.notesForTags(tags, email)` (visibility-filtered, `modifiedAt` desc), capped at 100 results. Each result is `{ path, snippet, score: 1, modifiedAt }`; the snippet is a ~160-character excerpt of the body (frontmatter stripped) read from `notes_fts`. The search modal shows the relative modified time instead of the relevance score when `modifiedAt` is present.
- An empty candidate set short-circuits to `[]` (logged as a failed search like any empty result).
- Comment FTS terms are now quote-escaped (`"` → `""`). Before, any quoted term containing `:` — e.g. `"tag:x"` — ended the FTS5 string early, `tag:` parsed as a column filter and the whole search threw.

## UI

- `TagsSection` (sidebar, after "Recently opened"): `useCollapsedSection('tags', true)`, header count = number of top-level tags, nested tags rendered as an indented tree (`utils/tag-tree.ts`, pure, vitest-tested) with per-node expand carets and counts. Hidden when the caller has no tags.
- Refresh: App bumps a counter on WebSocket `flushed`, `file:changed` and `file:tree-update`, and the section also refetches when the active file changes; fetches are debounced (400 ms) so a typing burst costs one request.
- Click a tag anywhere (sidebar node, top-bar pill, doc-header pill) → `App.openTagSearch(tag)` → search modal opens with `initialQuery = "tag:<tag>"`. ⌘K still opens it empty. Pills are `<button>`s with the existing `.kp-tag` look plus a hover state.

## Known limitations

- **Editor round trip of frontmatter (pre-existing).** The rendered editor loads the raw file into TipTap, which has no frontmatter node: `---` becomes a thematic break and `tags: [x]` followed by `---` becomes a setext heading. On the first local edit the re-serialised document is diffed against the raw shadow, so a flow-list frontmatter is written back as `---` + `## tags: [x]` and its tags drop out of the index; a block list happens to survive as a frontmatter-shaped block. The doc-header pills read that re-serialised markdown and can therefore disappear for flow-list frontmatter once the editor mounts; the top-bar pills read the raw file and are unaffected. Preserving frontmatter in the editor is a separate change.
- **Snippets of PIN-locked notes in REST search** are returned as for any other search result (pre-existing); only MCP substitutes the sentinel.
- Indented code blocks, `%% comments %%` and math blocks are not excluded from inline tag parsing.

## Alternatives considered

- **Expanding ancestors into rows** (`project` and `project/kalepin` both stored): simpler counting SQL, but doubles rows, complicates display forms and still needs prefix logic for filters. Rejected.
- **Post-filtering search results by tag**: no signature changes in `SearchService`, but loses tagged notes ranked beyond the FTS/vector top-50. Rejected.
- **Putting the parser in `@kalepin/shared`**: would need a build step for the shared package. Rejected for now; the duplication is limited to the frontmatter reader and both copies are tested.
