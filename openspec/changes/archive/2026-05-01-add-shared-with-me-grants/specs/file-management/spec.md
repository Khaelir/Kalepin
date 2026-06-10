# Spec delta: file-management (MODIFIED)

## MODIFIED Requirements

### Requirement: Tree includes shared-with-me virtual section

`GET /api/files/tree` SHALL include grant-visible paths grouped under a virtual `_shared_with_me` root for the requester. Foreign personal paths NOT covered by an active grant remain absent.

#### Scenario: Bob's tree includes Alice's shared note
- **GIVEN** Alice has an active read grant for Bob on `_users/alice/foo.md`
- **WHEN** Bob calls `GET /api/files/tree`
- **THEN** the response includes a `_shared_with_me/from-alice@x.com/foo.md` virtual entry
- **AND** other paths in Alice's personal folder are absent

### Requirement: Move rewrites grant paths atomically

When `POST /api/files/move` succeeds, all active grants on the moved path or its subtree SHALL have their `path` column updated in the same transaction.

#### Scenario: Move preserves grants
- **GIVEN** a grant on `_users/alice/old.md` for Bob
- **WHEN** Alice moves the note to `_users/alice/folder/new.md`
- **THEN** the grant's `path` is `_users/alice/folder/new.md` and Bob's next read at the new path succeeds
