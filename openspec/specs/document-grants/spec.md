## Purpose

Per-file user-to-user permission grants with read/comment/write, optional expiry, perpetual default, owner+admin revocation, and a "Shared with me" zone in the sidebar.

## Requirements

### Requirement: Owner mints per-file grants

The system SHALL provide `POST /api/grants` allowing the owner of a path (or an admin) to mint a grant for another user with a chosen permission and optional expiry. Default expiry is none (perpetual until revoked).

#### Scenario: Alice grants read on her note to Bob
- **GIVEN** Alice owns `_users/alice@x.com/foo.md`
- **WHEN** Alice POSTs `{ "grantee_email": "bob@x.com", "path": "_users/alice@x.com/foo.md", "permission": "read" }`
- **THEN** the response is 201 with the grant id; the grants table contains one active row

#### Scenario: Non-owner cannot grant
- **GIVEN** Bob does NOT own the path
- **WHEN** Bob POSTs the same body
- **THEN** the response is 403 (or 404 per existing visibility rules)

### Requirement: Grant gates downstream authz checks

`assertReadableBy(path, email)` SHALL allow when an active grant of any permission exists for the pair. `assertWritableBy` SHALL allow only on `write` grants. `assertCommentableBy` SHALL allow on `comment` or `write` grants.

#### Scenario: Read grant allows GET /api/files/read but not POST
- **GIVEN** an active read grant for Bob on Alice's path
- **WHEN** Bob calls `GET /api/files/read?path=...`
- **THEN** the response is 200 with content
- **WHEN** Bob calls `POST /api/files/create` against the same path
- **THEN** the response is 403

### Requirement: Grant revocation removes access immediately

`DELETE /api/grants/:id` SHALL set `revoked_at = now`. Subsequent `assertReadableBy` calls for the (path, grantee) pair SHALL fall through to the no-grant branch.

#### Scenario: Revocation
- **GIVEN** Bob has a read grant on Alice's path
- **WHEN** Alice DELETEs the grant
- **THEN** Bob's next `GET /api/files/read?path=...` returns 404

### Requirement: Grant expiry ends access at the timestamp

If `expires_at` is not null and `now > expires_at`, the grant SHALL be treated as inactive. The `findActive` query SHALL filter by both `revoked_at IS NULL` and (`expires_at IS NULL` OR `expires_at > now`).

#### Scenario: Expired grant
- **GIVEN** a grant with `expires_at = now - 1`
- **WHEN** Bob attempts to read the path
- **THEN** the response is 404

### Requirement: Path move updates grant rows in the same transaction

When `FilesService.move(src, dest)` succeeds, the grants service SHALL update every active grant where `path = src` or `path STARTSWITH src + '/'` to the new path, in the same transaction.

#### Scenario: Renamed granted note still visible to grantee
- **GIVEN** a grant on `_users/alice/old-name.md` for Bob
- **WHEN** Alice renames the note to `_users/alice/new-name.md`
- **THEN** the grant row is updated to the new path; Bob's next read at the new path returns 200

### Requirement: Path delete revokes all grants on the path subtree

When `FilesService.delete(path)` or `deleteDirectory(path)` succeeds, every active grant on the path or its descendants SHALL have `revoked_at = now`.

#### Scenario: Deleted granted note revokes
- **GIVEN** a grant on Alice's note for Bob
- **WHEN** Alice deletes the note
- **THEN** the grant row's `revoked_at` is set; Bob's next read returns 404

### Requirement: "Shared with me" sidebar lists active grants for the requester

The endpoint `GET /api/files/shared-with-me` SHALL return a list of paths where the requester is the active grantee, grouped by grantor. The frontend `FileTree.tsx` SHALL render a "SHARED WITH ME" sidebar section using this data.

#### Scenario: Bob sees Alice's shared note in his sidebar
- **GIVEN** Alice has an active read grant for Bob on `_users/alice/foo.md`
- **WHEN** Bob loads the workspace
- **THEN** the sidebar's "SHARED WITH ME" section shows a "from alice@x.com" group containing `foo.md`

### Requirement: Granting on E2E paths is rejected

`POST /api/grants` SHALL reject (`400 Bad Request`) any payload whose `path` makes `isE2EEncrypted(path)` return true. The error message SHALL mention that E2E sharing requires the `add-e2e-secure-subfolder` change.

#### Scenario: Stage-2 path rejected
- **GIVEN** stub `isE2EEncrypted('_users/alice/_secure/journal.md') === true`
- **WHEN** Alice POSTs a grant for that path
- **THEN** the response is 400 with a message naming `_secure/`

### Requirement: ShareDialog renders per-grantee view stats

`ShareDialog` (the per-file share dialog) SHALL fetch `GET /api/notes/:path/access-summary` alongside the grants list and render, for each grantee row, the view count and the relative time of the last view (e.g., `· 12 views · last 3h ago`). When the grantee has zero log rows, the line SHALL render `· Not yet viewed`.

#### Scenario: Active grantee with views
- **GIVEN** the summary returns `{ email: 'bob@x.com', view_count: 12, last_view_at: now-3h }`
- **AND** the grants list contains an active grant for `bob@x.com`
- **WHEN** the dialog renders
- **THEN** Bob's row shows `bob@x.com · 12 views · last 3h ago`

#### Scenario: Active grantee with no views
- **GIVEN** the summary contains no row for `bob@x.com`
- **AND** the grants list contains an active grant for `bob@x.com`
- **WHEN** the dialog renders
- **THEN** Bob's row shows `bob@x.com · Not yet viewed`

### Requirement: ShareDialog renders anonymous aggregate on the public-link panel

When a public share-link exists for the path, the dialog's public-link panel SHALL render the anonymous aggregate (`anonymous.resolve_count · last <relative>`).

#### Scenario: Public link with anonymous resolves
- **GIVEN** the summary returns `anonymous: { resolve_count: 47, last_resolve_at: now-12m }`
- **WHEN** the dialog renders
- **THEN** the public-link panel shows `47 anonymous · last 12m ago`

### Requirement: Stats line gracefully degrades when access-metadata is absent

If the `access-metadata` capability is not deployed (the summary endpoint returns 404 or 501), the dialog SHALL hide the per-grantee stats line and the anonymous aggregate without other behavioural changes.

#### Scenario: Endpoint missing
- **WHEN** `GET /api/notes/:path/access-summary` returns 404
- **THEN** the dialog renders without stats lines, and no error toast is shown
