## Context

Search currently indexes note content (markdown body + title) into FTS5 and vector embeddings. Comments live in `.collab` sidecar JSON files alongside notes and are never touched by the search pipeline. The `SearchResult` type is note-centric: `{ path, snippet, score, heading? }`.

The comment CRUD operations in `CommentsService` delegate storage to `SidecarService`, which reads/writes JSON files via the `StorageAdapter`. There is no file-watcher for `.collab` files — changes are only made through the API.

## Goals / Non-Goals

**Goals:**
- Make comment text discoverable via both FTS5 keyword search and vector/semantic search
- Return comment matches as a distinct result type so the UI can render them differently
- Keep indexing in sync with comment writes (create, reply, delete)
- Maintain graceful degradation: if embeddings aren't ready, comment FTS still works

**Non-Goals:**
- Searching within resolved/archived threads differently (all threads are indexed equally)
- Full-text highlighting within the editor when navigating to a comment result (existing comment panel handles display)
- Watching `.collab` files on disk (comments are only written through the API)

## Decisions

### 1. Separate FTS5 table for comments (`comments_fts`)

**Decision**: Create a new `comments_fts` virtual table rather than mixing comment text into `notes_fts`.

**Rationale**: Keeps note and comment indexes independent — easier to reason about, reindex, and debug. The merge already happens at the RRF level, so adding a third ranking source (comment FTS) is straightforward. Mixing them would require a `type` discriminator column which FTS5 doesn't support natively.

**Alternative considered**: Appending comment text to the note's FTS content. Rejected because it conflates the two sources, making snippets unreliable and preventing distinct result types.

### 2. Shared `note_embeddings` table with a `source` column

**Decision**: Add a `source TEXT NOT NULL DEFAULT 'note'` column to the existing `note_embeddings` table rather than a separate table.

**Rationale**: The brute-force cosine scan already loads all rows — a separate table would require a second scan. Adding a column lets us filter or tag results at scoring time with zero extra I/O. The `source` values are `'note'` or `'comment'`. The primary key becomes `(path, source, chunk_idx)`.

**Alternative considered**: Separate `comment_embeddings` table. Rejected because it doubles the scan cost and adds complexity to the merge step.

### 3. Index lifecycle: hook into `CommentsService` write operations

**Decision**: After every write operation (`addComment`, `replyToThread`, `deleteComment`, `resolveThread`), re-index all comments for that note path.

**Rationale**: Comments per note are few (typically 1-10 threads). Re-indexing all comments for a single note after any write is simple and fast (~5-20ms). Tracking individual comment inserts/deletes for surgical index updates isn't worth the complexity.

**Alternative considered**: File-watcher on `.collab` files. Rejected because comments are only written through the API, so hooking the service layer is sufficient and more reliable.

### 4. `SearchResult` type extension

**Decision**: Add optional fields to `SearchResult`:
```typescript
type?: 'note' | 'comment';       // default 'note' for backward compat
threadId?: string;                // comment thread ID
commentAuthor?: string;           // who wrote the matching comment
notePath?: string;                // parent note (when type='comment', path may equal notePath)
```

**Rationale**: Keeps the single result list and RRF merge, while giving the frontend enough metadata to render comment results distinctly and navigate to the right thread.

### 5. RRF merge: three-way

**Decision**: Extend `mergeResults` to accept three ranked lists: FTS notes, FTS comments, and vector results (tagged with source). Comments FTS gets the same weight as note FTS (1.0). Vector results keep their 1.5x boost regardless of source.

**Rationale**: Comments shouldn't outrank notes by default — they're supplementary. Equal FTS weight plus the vector boost naturally surfaces the most semantically relevant results.

### 6. Frontend: comment results as a visually distinct row

**Decision**: Render comment results in the same list as note results, but with a comment icon, the author, and the matched text. Clicking navigates to the parent note (same as note results) — opening the comment panel is a future enhancement.

**Rationale**: Keeps the search modal simple. The user sees "this term was mentioned in a comment on note X" and can navigate there.

## Risks / Trade-offs

- **Startup re-indexing**: On first deploy, all `.collab` files need to be scanned and indexed. At ~2,500 notes this is fast (<5s), but worth logging.
  → Mitigation: Run comment indexing in `reindexAll` alongside note indexing.

- **Stale index on manual sidecar edits**: If someone edits a `.collab` file outside the API (e.g., git pull), the comment index won't update until `reindexAll` is triggered.
  → Mitigation: Acceptable — comments are API-only by design. Document as known limitation.

- **Embedding dimension migration**: Adding a `source` column to `note_embeddings` requires a migration (add column with default).
  → Mitigation: Use `ALTER TABLE ... ADD COLUMN` which SQLite handles without rewriting data. The existing `hasStaleEmbeddings` check handles dimension mismatches.
