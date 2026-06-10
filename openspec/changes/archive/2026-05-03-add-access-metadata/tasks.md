# Tasks — access metadata

## 1. Schema + service

- [x] 1.1 Add SQLite migration creating `note_access_log` and indexes.
- [x] 1.2 Create `packages/backend/src/access-log/access-log.service.ts`: `record(path, viewer, action, ip)`, `listForPath(path, since, limit)`, `deleteForViewer(viewer)`. In-memory dedup LRU.
- [x] 1.3 Read `ACCESS_LOG_IP_SALT` from env; if missing, generate 32B and persist to a file (e.g., `data/.access-log-salt`) on first boot.
- [x] 1.4 Unit tests: dedup window correctness; salt-based ip_hash determinism.

## 2. Hooks into existing routes

- [x] 2.1 Hook `FilesController.readFile` to call `record(path, email, 'view'|'fetched', ip)` based on `isE2EEncrypted(path)`.
- [x] 2.2 Hook `FilesController.createFile` and the OT-edit path to call `record(path, email, 'edit', ip)`.
- [x] 2.3 Hook `CommentsController.create` to call `record(path, email, 'comment', ip)`.
- [x] 2.4 Hook `ShareLinksController.resolve` to call `record(path, 'anonymous', 'share-link-resolved', ip)`.

## 3. Read endpoint + UI

- [x] 3.1 `AccessLogController` mounted at `/api/notes/:path/access-log`, gated by owner-or-admin.
- [x] 3.2 Frontend `ActivityPanel.tsx` showing recent rows with relative timestamps.
- [x] 3.3 Hide panel for non-owner non-admin viewers.

## 4. Retention + erasure

- [x] 4.1 Daily cron pruning rows older than retention.
- [x] 4.2 `DELETE /api/users/me/access-log` — authenticated user erasure.
- [x] 4.3 `DELETE /api/admin/users/{email}/access-log` — admin scope.
- [x] 4.4 README privacy section: retention default, how to configure, how to invoke right-to-erasure.

## 5. Tests

- [x] 5.1 Each route hook produces the expected row.
- [x] 5.2 Owner sees access log; non-owner gets 403.
- [x] 5.3 Right-to-erasure removes only the requesting user's rows.
- [x] 5.4 Retention cron prunes correctly.
- [x] 5.5 Stage-2 contract: stub `isE2EEncrypted = true` for a path; reads log as `'fetched'`.
