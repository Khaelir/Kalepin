# Spec delta: comments (MODIFIED)

## ADDED Requirements

### Requirement: Comment provenance via share-link is recorded

The `comments` table SHALL include an optional `via_share_code TEXT` column. When a comment is created via the public share-link viewer by a now-authenticated user, the share code in use SHALL be persisted in this column.

#### Scenario: Provenance recorded
- **GIVEN** Bob is authenticated and viewing `/share/abc123` for `Notes/foo.md`
- **WHEN** Bob posts a comment from that page
- **THEN** the comment row has `via_share_code = 'abc123'`

### Requirement: Comment creation is rate-limited per user

The system SHALL reject comment creations exceeding 30 / hour / authenticated user with a `429 Too Many Requests` response.

#### Scenario: Rate limit enforced
- **GIVEN** Bob has posted 30 comments in the last 60 minutes
- **WHEN** Bob attempts a 31st comment
- **THEN** the response is `429`
