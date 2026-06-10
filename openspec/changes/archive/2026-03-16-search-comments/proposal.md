## Why

Comments contain valuable discussion — decisions, context, questions — that is currently invisible to search. When a user searches for a term that only appears in a comment thread, they get zero results, even though the information exists in the vault. Including comments in search makes the full knowledge base discoverable.

## What Changes

- Index comment text from `.collab` sidecar files into both FTS5 and vector search
- Return comment matches as a distinct result type alongside note matches
- Show comment results in the search modal with a visual indicator (comment icon, quoted text, author) and link to the parent note
- Re-index comments when they are created, replied to, or deleted

## Capabilities

### New Capabilities
- `comment-search-indexing`: Index comment text from sidecar files into FTS5 and embedding tables, with lifecycle hooks on comment CRUD operations
- `comment-search-results`: Return and display comment matches as a distinct result type in the search API and frontend modal

### Modified Capabilities

_(none — search and comments APIs are extended, not changed in a breaking way)_

## Impact

- **Backend**: `SearchService` gains new FTS5 table (`comments_fts`) and new rows in `note_embeddings` with a `source` discriminator. `CommentsService` calls search indexing on write operations.
- **Shared types**: `SearchResult` gains an optional `type` field (`'note' | 'comment'`) and comment-specific metadata (`threadId`, `author`, `commentSnippet`).
- **Frontend**: `SearchModal` renders comment results with a distinct visual treatment.
- **Performance**: Negligible — comments are short and few per note. At 2,500 notes with ~5 comments each, adds ~12k short FTS rows and ~12k small embedding chunks.
- **Dependencies**: None new.
