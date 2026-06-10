# Tasks — shared-with-me grants

## 1. Schema + service

- [x] 1.1 SQLite migration: `document_grants` + 3 indexes.
- [x] 1.2 `packages/backend/src/grants/grants.service.ts`: `mint`, `revoke`, `findActive(path, email)`, `listForGrantee(email)`, `listForGrantor(email)`, `cascadeRename(src, dest)`, `cascadeDelete(path)`. Active = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now)`.
- [x] 1.3 Unit tests: lifecycle (mint → list → revoke), expiry, rename cascade, delete cascade.

## 2. Predicate consolidation

- [x] 2.1 Refactor `auth/visibility.ts` to expose `visibilityFor(path, email, ctx?) → Visibility`. Old `isVisibleTo` becomes a derived helper.
- [x] 2.2 Update every `assertReadableBy` / `assertWritableBy` call site to use the new resolver. Many are already in place from the personal-folders capability — confirm coverage.
- [x] 2.3 New `assertCommentableBy(path, email)` for comments routes.
- [x] 2.4 Truth-table unit tests per `design.md`.

## 3. HTTP endpoints

- [x] 3.1 `POST /api/grants` — mint (owner-only).
- [x] 3.2 `DELETE /api/grants/:id` — revoke (grantor or admin).
- [x] 3.3 `GET /api/grants?as=grantor|grantee` — list.
- [x] 3.4 `GET /api/files/shared-with-me` — tree-shaped view of granted paths grouped by grantor.

## 4. Tree integration

- [x] 4.1 `FilesService.listTree` includes a `_shared_with_me` virtual root for the requester (similar to `_users` virtual root).
- [x] 4.2 `FileTree.tsx` adds a third top-level "SHARED WITH ME" section, partitioning the tree response.

## 5. Cascade hooks

- [x] 5.1 `FilesService.move` calls `grants.cascadeRename(src, dest)` in the same transaction.
- [x] 5.2 `FilesService.delete` and `deleteDirectory` call `grants.cascadeDelete(path)`.
- [x] 5.3 Tests: rename a granted note → grant follows; delete a granted folder → grants revoked.

## 6. Frontend

- [x] 6.1 Share-dialog component: single recipient, permission picker, expiry picker, file list (for folder), Apply button.
- [x] 6.2 Context-menu entries: "Share file…" on file rows, "Share folder…" on folder rows.
- [x] 6.3 New-file-in-shared-folder toast hook in `FilesService.createFile` callback.
- [x] 6.4 Grants management page: `Settings → Sharing`. Two tables — "I've shared" and "Shared with me", with revoke buttons.

## 7. Stage-2 interaction

- [x] 7.1 Reject `POST /api/grants` when `isE2EEncrypted(body.path)` returns true. Clear error message referencing the future E2E sharing change.

## 8. Tests

- [x] 8.1 Truth-table tests per `design.md`.
- [x] 8.2 e2e: Alice grants read, Bob reads but not writes; Alice revokes, Bob's next read 404s.
- [x] 8.3 e2e: Bulk folder share mints N grants in one transaction.
- [x] 8.4 e2e: Sidebar "Shared with me" shows granted files grouped by grantor.
- [x] 8.5 Leak sweep: foreign personal paths NOT in any grant remain 404 across every authenticated route.
