## 1. Database Schema

- [x] 1.1 Add `source TEXT NOT NULL DEFAULT 'note'` column to `note_embeddings` table (ALTER TABLE migration in `createEmbeddingsTable`, update primary key to `(path, source, chunk_idx)`)
- [x] 1.2 Create `comments_fts` FTS5 virtual table with columns: `path`, `thread_id`, `content` (in `SearchService.onModuleInit`)

## 2. Comment Indexing in SearchService

- [x] 2.1 Add `indexNoteComments(notePath: string)` method — reads sidecar via `SidecarService`, indexes all threads into `comments_fts` (one row per thread: concatenated comment text + quotedText)
- [x] 2.2 Add `indexCommentEmbeddings(notePath: string)` method — generates embeddings for comment threads and inserts into `note_embeddings` with `source = 'comment'`
- [x] 2.3 Add `removeNoteComments(notePath: string)` method — deletes comment entries from `comments_fts` and `note_embeddings WHERE source = 'comment'`
- [x] 2.4 Update `reindexAll()` to scan `.collab` sidecar files and call `indexNoteComments` + `indexCommentEmbeddings` for each
- [x] 2.5 Inject `SidecarService` into `SearchService` (update `SearchModule` imports/providers)

## 3. Hook Comment CRUD to Indexing

- [x] 3.1 Inject `SearchService` into `CommentsService` (update `CommentsModule` imports)
- [x] 3.2 Call `indexNoteComments` + `indexCommentEmbeddings` after `addComment`, `replyToThread`, and `deleteComment` in `CommentsService`

## 4. Search Query + Merge

- [x] 4.1 Add `commentFtsSearch(query: string)` method — queries `comments_fts`, returns results with `type: 'comment'`, `threadId`, and first comment author
- [x] 4.2 Update `vectorSearch` to include `source` in returned results so comment vectors are distinguishable
- [x] 4.3 Update `mergeResults` to three-way RRF: note FTS (weight 1.0), comment FTS (weight 1.0), and vector results (weight 1.5, tagged by source)
- [x] 4.4 Update `search()` to call `commentFtsSearch` and pass all three lists to `mergeResults`

## 5. Shared Types

- [x] 5.1 Extend `SearchResult` in `packages/shared/src/models.ts` with optional fields: `type?: 'note' | 'comment'`, `threadId?: string`, `commentAuthor?: string`
- [x] 5.2 Update `SearchResult` in `packages/frontend/src/api.ts` to match shared type
- [x] 5.3 Update backend `SearchResult` interface in `search.service.ts` to match shared type

## 6. Frontend Search Modal

- [x] 6.1 Update `SearchModal` to render comment results with a comment icon, author name, and comment snippet
- [x] 6.2 Add CSS styles for the comment result variant (`.search-modal-result--comment`)

## 7. Testing

- [x] 7.1 Add unit tests for comment FTS indexing and querying in `search.service.test.ts`
- [x] 7.2 Verify `reindexAll` includes comments (extend existing test or add new)
