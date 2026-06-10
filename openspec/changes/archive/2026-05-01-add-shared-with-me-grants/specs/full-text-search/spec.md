# Spec delta: full-text-search (MODIFIED)

## MODIFIED Requirements

### Requirement: Search results include grant-visible foreign personal paths

The FTS5 search predicate SHALL be extended so a result is returned when the requester is the owner OR has an active grant on the path. The query SHALL NOT leak foreign personal paths the requester has no relationship with.

#### Scenario: Bob's search hits Alice's shared note
- **GIVEN** Alice has an active read grant for Bob on `_users/alice/foo.md` containing the word "kelp"
- **WHEN** Bob searches for "kelp"
- **THEN** the result list includes `_users/alice/foo.md`

#### Scenario: Bob's search does NOT hit Alice's other notes
- **GIVEN** Alice has an active grant on `foo.md` only
- **AND** Alice has another note `bar.md` also containing "kelp" with no grant
- **WHEN** Bob searches for "kelp"
- **THEN** the result list does NOT include `_users/alice/bar.md`
