# Tasks — add stable doc handles

## 1. Schema and service

- [x] 1.1 New TypeORM entity `packages/backend/src/entities/doc-handle.entity.ts` (`id` 16-char base32 PK, `path` UNIQUE, `created_at`, `tombstone_at` nullable). `synchronize=true` picks it up.
- [x] 1.2 New module `packages/backend/src/doc-handles/doc-handles.module.ts` exporting `DocHandlesService`.
- [x] 1.3 New `DocHandlesService` with: `findOrCreateForPath(path)`, `forPath(path)` (no mint), `resolve(id)`, `updatePath(id, newPath)`, `tombstone(id)`, `untombstone(id)` (for backup-restore corner case if path matches).
- [x] 1.4 ID generation: 16-char base32 (`A-Z2-7`), crypto-random, retry on collision. Helper colocated.
- [x] 1.5 Unit tests for `DocHandlesService`: mint, idempotent mint, resolve, resolve-tombstoned, resolve-unknown, updatePath, tombstone.

## 2. File CRUD wiring

- [x] 2.1 `FilesService.create` calls `findOrCreateForPath` after disk create.
- [x] 2.2 `FilesService.delete` calls `tombstone` after disk delete (best-effort — disk delete is the source of truth).
- [x] 2.3 `FilesService.move` / `FilesService.rename` calls `updatePath` in the same transaction (mirrors the existing `short_links` rewrite).
- [x] 2.4 Unit tests: create mints, delete tombstones, rename/move preserves ID.

## 3. Read endpoint accepts handle

- [x] 3.1 `GET /api/files/read` accepts either `?path=…` or `?handle=…`. When `handle` is provided, resolve via `DocHandlesService` first; 410 + `{ tombstoned: true }` on tombstone, 404 on unknown.
- [x] 3.2 Response shape always includes `handle: { id, path }` so the frontend can normalize the URL bar.
- [x] 3.3 Unit tests: read by handle, read by path, tombstone returns 410 with body shape.

## 4. File watcher integration

- [x] 4.1 `FileWatcherService` `add` event: if no handle exists for the path, mint via `findOrCreateForPath`. Fast no-op if one already exists (the common case during normal save flow).
- [x] 4.2 `unlink` event: look up by path, tombstone if found.
- [x] 4.3 Rename pairs reconciled via `rename-correlator`: when a paired `unlink` + `add` are detected, call `updatePath` instead of tombstone+mint.
- [x] 4.4 Unit tests: external add mints, external delete tombstones, rename-correlated pair preserves ID.

## 5. Share-link integration

- [x] 5.1 `GET /api/share-links/resolve/:code` response gains `handleId` (from `forPath(row.path)` — minted lazily if absent).
- [x] 5.2 `infoForCodeIncludingGone` likewise carries `handleId` for the gone-code path (so the frontend can still show "this note no longer exists" if both link is gone *and* note is tombstoned).
- [x] 5.3 Unit tests: resolve carries handleId; resolve on tombstoned path still returns 410 from the share-link layer (the frontend doesn't need to chain).

## 6. Frontend URL routing

- [x] 6.1 `urls.ts`: add `DOC_HANDLE_RE = /^[A-Z2-7]{16}$/`. `parseDocUrl` matches `/doc/<segment>` against the regex → `{ handleId }`; otherwise → `{ filePath }` (legacy fallback).
- [x] 6.2 Remove `buildDocUrl` and `buildCosmeticPath` exports. Keep `buildShareLinkUrl` (already path-free) and `buildLegacyDocUrl` (rename it `buildDocUrlByPath` if the "legacy" framing reads wrong).
- [x] 6.3 Add `buildDocUrlByHandle(handleId, heading?, threadId?)` that emits `/doc/<id>(#<heading>)?(?thread=<id>)?`.
- [x] 6.4 `parseDocUrl`: drop the `/s/<code>/<cosmetic>` and `/d/<code>/<cosmetic>` cosmetic arms entirely. Only `/s/<code>` and `/d/<code>` (code-only) remain.
- [x] 6.5 `Editor.tsx` in-doc link handler: drop cosmetic arm; recognise `/doc/<id>` for internal cross-doc links and emit handle-based URLs when authoring an in-doc link.
- [x] 6.6 Unit tests for `urls.ts`: handle vs path detection, build helpers.

## 7. Frontend openFile + normalization

- [x] 7.1 `App.tsx` `openFile`: drop the `existingCode` branch entirely. Always call `api.readFile({ path | handleId })`; on response, `replaceState('/doc/' + response.handle.id + querySuffix + hash)`.
- [x] 7.2 Initial-load handler (the `parseDocUrl` consumer): when `parsed.handleId` → read by handle → `openFile(handlePath, ...)`; when `parsed.code` → resolve → read by handleId from the resolve response → `openFile(...)`; when `parsed.filePath` → read by path → `openFile(...)`.
- [x] 7.3 popstate handler: same shape; preserves `?thread=` and `#heading`.
- [x] 7.4 Drop the cosmetic-fallback at the existing `App.tsx:919-922` lines (now resolves to a single tombstone/410 path).
- [x] 7.5 Drop the two share-link `replaceState`s that overwrote the address bar with `/s/<code>` (`App.tsx:1265-66`, `App.tsx:1878-79`).

## 8. Tombstone surface

- [x] 8.1 New `DocTombstoneCard` (or extend `share-link-gone` styling) — title "This note no longer exists", body copy as in design.md.
- [x] 8.2 `App.tsx`: when `read` returns 410 + `{ tombstoned: true }`, render the tombstone card.
- [x] 8.3 Distinct telemetry / log line so tombstone hits are distinguishable from share-link 410s.

## 9. API client

- [x] 9.1 `api.ts`: `readFile({ path } | { handleId })` returns `{ content, revision, handle: { id, path }, ... }`.
- [x] 9.2 `resolveShareLinkPublic` response shape gains `handleId`.

## 10. Integration tests

- [x] 10.1 Backend e2e: create file → read returns handle → URL `/api/files/read?handle=<id>` returns same content. Rename → `?handle=<id>` still resolves to the new path. Delete → 410 with `{ tombstoned: true }`.
- [x] 10.2 Frontend e2e: open unshared doc → URL bar becomes `/doc/<id>`. Mint share-link → URL bar unchanged, clipboard has `/s/<code>`. Click `/s/<code>` while authed → URL bar normalizes to `/doc/<id>`. Click `/s/<code>#heading` while authed → URL bar `/doc/<id>#heading`.  *(Covered by `packages/frontend/e2e/doc-handles.spec.recipe.md` Scenarios 1–4 — recipes are this repo's manual-QA Playwright convention; see `packages/frontend/e2e/README.md`.)*
- [x] 10.3 Frontend e2e: legacy `/doc/<full/path>` URL still resolves and immediately normalizes to `/doc/<id>`.  *(Covered by `packages/frontend/e2e/doc-handles.spec.recipe.md` Scenario 5.)*

## 11. Documentation

- [x] 11.1 Update `openspec/specs/file-management/spec.md` per the delta.
- [x] 11.2 Update `openspec/specs/share-links/spec.md` per the delta.
- [x] 11.3 Add `openspec/specs/doc-handles/spec.md` per the new capability.
- [x] 11.4 Run `openspec list` + `openspec validate add-stable-doc-handles --strict`.

## 11.5 Cosmetic dropped from notification emails

- [x] 11.5.1 `NotificationService.buildDocLink` emits `${APP_URL}/doc/<handleId>` (handle minted via `DocHandlesService.findOrCreateForPath`); `buildCosmeticPath` helper removed.
- [x] 11.5.2 `CommentsModule` imports `DocHandlesModule`; the optional `ShareLinksService` injection on `NotificationService` is replaced by `DocHandlesService`.
- [x] 11.5.3 Update share-links spec delta + canonical spec to reflect the new email URL form (no cosmetic, no `/d/<code>`).

## 12. Migration considerations (no work, but verify)

- [x] 12.1 Confirm that the first chokidar `add` after deploy mints handles for files-touched-since-deploy (lazy backfill).  *(`rename-tracking.service.ts:39` — chokidar `add` calls `docHandles.findOrCreateForPath`, idempotent on existing rows.)*
- [x] 12.2 Confirm that an authed user who lands on a pre-deploy `/s/<code>/<cosmetic>` URL still resolves: code-arm matches, cosmetic is dropped from the parser, normalize to `/doc/<id>`.  *(`urls.ts:65-73` — parser slices to first `/`, returns code only; cosmetic discarded.)*
- [x] 12.3 Confirm that an authed user who lands on a pre-deploy `/doc/<full/path>` URL still resolves: legacy path arm matches, normalize to `/doc/<id>`.  *(`urls.ts:75-85` — segment with a `/` or non-base32 falls through to the `filePath` arm; `App.tsx` reads-by-path and `replaceState`s to `/doc/<handle.id>`.)*
