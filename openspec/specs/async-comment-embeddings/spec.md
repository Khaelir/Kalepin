## Purpose

Computes comment embeddings asynchronously so comment creation stays fast.

## Requirements

### Requirement: Async embedding on comment creation
The system SHALL index comment embeddings asynchronously (fire-and-forget) when a comment is added via `addComment()`. FTS indexing (`indexNoteComments`) SHALL remain synchronous.

#### Scenario: Add comment response time
- **WHEN** a user adds a comment via MCP `add_comment` or the REST API
- **THEN** the response is returned after sidecar write and FTS indexing, without waiting for embedding indexing

#### Scenario: Embedding completes in background
- **WHEN** `indexCommentEmbeddings()` is called asynchronously after a comment is added
- **THEN** the embedding is indexed in the background and available for vector search within seconds

#### Scenario: Embedding failure does not affect comment
- **WHEN** the async `indexCommentEmbeddings()` call fails (e.g., embedding model not ready)
- **THEN** the error is logged, the comment remains saved, and FTS search still finds the comment

### Requirement: Async embedding on comment reply
The system SHALL apply the same async embedding pattern to `replyToThread()`.

#### Scenario: Reply to thread response time
- **WHEN** a user replies to an existing comment thread
- **THEN** the response is returned after sidecar write and FTS indexing, without waiting for embedding indexing
