# Spec delta: document-grants (MODIFIED)

## ADDED Requirements

### Requirement: Grants follow rename of the granted path

When the grantor renames a granted file, all active grants on the old path SHALL be updated to the new path. When the grantor renames a folder, all active grants on descendants SHALL be updated to the new prefix.

#### Scenario: File rename rewrites the grant path
- **GIVEN** Alice has granted `notes/foo.md` to Bob with permission `read`
- **WHEN** Alice renames `notes/foo.md` to `notes/bar.md`
- **THEN** the grant row's `path` is `notes/bar.md` and Bob's `_shared_with_me/from alice@…` lists `bar.md` only

#### Scenario: Folder rename rewrites all descendant grants
- **GIVEN** Alice has granted `notes/folder/a.md` and `notes/folder/b.md` to Bob
- **WHEN** Alice renames `notes/folder/` to `notes/renamed/`
- **THEN** both grant rows are rewritten and Bob's tree shows `_shared_with_me/from alice@…/renamed/{a,b}.md`

### Requirement: Grants are revoked when the granted path is deleted

When the grantor deletes a granted file, the system SHALL set `revoked_at = now` on all active grants for that path. When a folder is deleted, all descendant grants SHALL be revoked.

#### Scenario: File delete revokes the grant
- **GIVEN** Alice has an active grant on `notes/foo.md` to Bob
- **WHEN** Alice deletes `notes/foo.md`
- **THEN** the grant row has `revoked_at` set and Bob's tree no longer lists the file
- **AND** Bob's `GET /api/files/read?path=notes/foo.md` returns 404

#### Scenario: Folder delete revokes descendant grants
- **GIVEN** Alice has granted `notes/folder/a.md` and `notes/folder/b.md` to Bob
- **WHEN** Alice deletes `notes/folder/` recursively
- **THEN** both grant rows are revoked

### Requirement: `_shared_with_me/` listing filters dangling grants

`FilesService.buildSharedWithMeRoot` SHALL filter out grants whose `path` does not exist on disk and asynchronously revoke them.

#### Scenario: Pre-existing dangling row is filtered and GC'd
- **GIVEN** a grant row exists for a path that no longer exists on disk (legacy data, before the rename/delete hooks shipped)
- **WHEN** Bob requests `GET /api/files/shared-with-me`
- **THEN** the response does not include the dangling path
- **AND** on the next read of the same endpoint, the row's `revoked_at` is set
