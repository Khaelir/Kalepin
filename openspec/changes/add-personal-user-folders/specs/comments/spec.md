## MODIFIED Requirements

### Requirement: Comment routes gate by viewer visibility

Every path-keyed route under `/api/comments` SHALL gate access via the visibility predicate. Reads call `assertReadableBy(path, viewerEmail)`; writes call `assertWritableBy(path, viewerEmail)`. Foreign personal paths SHALL return `404 Not Found`.

#### Scenario: Read comments on foreign personal note returns 404
- **WHEN** Bob calls `GET /api/comments?path=_users/alice@example.com/Diary.md`
- **THEN** the response status is `404 Not Found`

#### Scenario: Add comment on foreign personal note returns 404
- **WHEN** Bob calls `POST /api/comments` with `path = _users/alice@example.com/Diary.md`
- **THEN** the response status is `404 Not Found` and no comment is created

#### Scenario: Owner can read and write comments on own personal note
- **WHEN** Alice calls `GET /api/comments?path=_users/alice@example.com/Diary.md` and `POST /api/comments` for that path
- **THEN** both calls succeed

### Requirement: Comment search respects viewer visibility

The `comments_fts` query path SHALL apply the same viewer-visibility predicate as `full-text-search`. Comment hits whose underlying document path is not visible to the viewer SHALL be excluded.

#### Scenario: Comment-search hit on foreign personal note excluded
- **WHEN** Alice has a comment containing token `COMMENTTOK` on a personal note, and Bob runs a search that matches that comment
- **THEN** Bob's search response contains zero hits referencing the personal note
