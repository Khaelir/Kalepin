## 1. Phase 1 — Backend schema + entity

- [ ] 1.1 Create entity `packages/backend/src/entities/note-milestone.entity.ts` with columns `id` (int PK), `path` (varchar, indexed), `name` (varchar 80, NOT NULL), `description` (text, nullable), `content` (text, NOT NULL), `anchorChangeId` (int, nullable, FK → `note_changes.id`, ON DELETE SET NULL), `anchorChangeCreatedAt` (timestamp, nullable), `anchorAuthorEmail` (varchar, nullable), `createdBy` (int, nullable, FK → `User.id`, ON DELETE SET NULL), `createdAt` (timestamp, default now). Unique index on `(path, name)`. Index on `path` (query-by-path).
- [ ] 1.2 Add a TypeORM migration `packages/backend/src/migrations/<timestamp>-AddNoteMilestones.ts` creating the table, indexes, and FKs. Verify the migration is idempotent and reversible.
- [ ] 1.3 Register the entity in `packages/backend/src/changes/changes.module.ts` (or the equivalent module that owns history).
- [ ] 1.4 Add `Milestone` shape to `packages/shared/src/models.ts`: `{ id, path, name, description?, createdBy, createdByEmail, createdAt, anchorChangeId?, anchorChangeCreatedAt?, anchorAuthorEmail? }`. (Note: `content` is intentionally excluded from the list shape — fetched separately via the `get` endpoint.)
- [ ] 1.5 Run `pnpm typeorm migration:run` against a scratch dev DB and confirm schema matches the entity. Roll back to confirm `down()` works.

## 2. Phase 2 — Backend service

- [ ] 2.1 Create `packages/backend/src/changes/milestones.service.ts` with the following methods:
  - `createFromCurrent(path, userId, name, description?)` — trims `name`, rejects empty-after-trim with a typed validation error, reads current file content from disk (via `FilesService` or storage adapter), captures the latest `note_changes` row for `path` if present, denormalizes its author email and `createdAt`, inserts a `note_milestones` row.
  - `createFromChange(path, userId, changeId, name, description?)` — same trim/validate; reconstructs content via the existing `version-reconstruction` service for that `changeId`, denormalizes the change's author + `createdAt`, inserts the row.
  - `listByPath(path)` — returns `Milestone[]` ordered by `createdAt` descending (without `content`).
  - `getById(id)` — returns the full milestone including `content`.
  - `update(id, userId, patch: { name?, description? })` — authorization: only `createdBy` OR admin (403 otherwise); rejects any patch key other than `name`/`description` with `400`; trims `name`; re-checks `(path, name)` uniqueness and returns `409` on conflict; updates the row.
  - `restore(id)` — reads the milestone, applies `content` via the same OT-write path used by `restore-from-history` (`ChangesService.restoreFromContent(path, content)`-style helper); inherits `restore-safety` semantics (auto-snapshot pre-restore content; no-op when content identical to current). Returns `{ ok: true, newChangeId | null }`.
  - `deleteById(id, userId)` — hard delete (no soft-delete in v1). Authorization: only `createdBy` user, OR an admin (define admin via existing role check). 403 otherwise.
- [ ] 2.2 Unit-test `MilestonesService` with an in-memory SQLite + temp-dir fs:
  - create-from-current materializes content matching disk
  - create-from-change reconstructs the right content for the given changeId
  - duplicate `(path, name)` returns a typed conflict error
  - delete-not-by-creator returns 403
  - restore writes the milestone content as a new change in `note_changes`
  - listByPath excludes `content` from returned rows (size assertion)
- [ ] 2.3 Extend the existing rename-path service (the one invoked by the chokidar correlation pipeline per the `rename-tracking` capability — likely `packages/backend/src/files/rename-path.service.ts` or equivalent) to also update `note_milestones.path` inside the same transaction that updates `starred_items` and `note_changes`. Folder renames MUST propagate via prefix rewrite (same SQL pattern as the existing `note_changes` folder-rename SQL). On unique-constraint violation `(path, name)`, the service MUST NOT abort the rename: it auto-suffixes the colliding source milestone's name with ` (renamed)`, retrying with ` (renamed 2)`, ` (renamed 3)`, … until unique, and logs a warning at WARN level. Add a unit test covering: simple file rename, folder rename, single-row collision, two-collisions-in-a-row needing ` (renamed 2)`.
- [ ] 2.4 Confirm there is NO cascade-delete on file deletion. Add a unit test demonstrating that deleting a file leaves `note_milestones` rows intact for that path.
- [ ] 2.5 Confirm `pruneVersionHistory()` is unchanged. Add a unit test demonstrating that pruning all `note_changes` for a path leaves milestones queryable, with `anchorChangeId = NULL` and `content` intact.

## 3. Phase 3 — Backend API

- [ ] 3.1 In `packages/backend/src/files/files.controller.ts` add:
  - `POST /api/files/milestones` — body `{ path, name, description?, fromChangeId? }`. If `fromChangeId` is omitted, creates from current content. Returns `400` on empty-after-trim name, `409` on duplicate `(path, name)`.
  - `GET /api/files/milestones?path=<path>` — returns `Milestone[]`.
  - `GET /api/files/milestones/:id` — returns full milestone including `content`.
  - `PATCH /api/files/milestones/:id` — body restricted to `{ name?, description? }`. Rejects any other key with `400`. Returns `403` for non-creator non-admin, `409` on name conflict.
  - `POST /api/files/milestones/:id/restore` — restores via OT and returns `{ ok: true, newChangeId | null }` (null on identical-content no-op).
  - `DELETE /api/files/milestones/:id` — deletes; returns `{ ok: true }`. Returns `403` for non-creator non-admin.
- [ ] 3.2 Apply the existing auth guard / API key scope check to all six routes. Define a new scope `milestones:write` for create/PATCH/delete/restore. Reuse the existing read scope for list/get. Confirm existing scopes are not silently widened.
- [ ] 3.3 Document each route's response shape, status codes, and error cases (400 on validation, 403 on edit/delete-not-by-creator, 404 on unknown id, 409 on duplicate `(path, name)`, 422 on reconstruction or restore failure).
- [ ] 3.4 Add controller-level integration tests covering happy path + each error branch (one test per status code per route).

## 4. Phase 4 — Frontend API client + types

- [ ] 4.1 Confirm `Milestone` type imported from `@kalepin/shared` after Phase 1.4 lands.
- [ ] 4.2 Add typed wrappers in `packages/frontend/src/api.ts`:
  - `createMilestone(input: { path, name, description?, fromChangeId? }): Promise<Milestone>`
  - `listMilestones(path: string): Promise<Milestone[]>`
  - `getMilestone(id: number): Promise<MilestoneWithContent>`
  - `updateMilestone(id: number, patch: { name?: string; description?: string }): Promise<Milestone>`
  - `restoreMilestone(id: number): Promise<{ newChangeId: number | null }>`
  - `deleteMilestone(id: number): Promise<void>`
- [ ] 4.3 No new runtime dependency expected. Verify `tsc -b` clean.

## 5. Phase 5 — Frontend: VersionHistoryPanel milestone affordances

- [ ] 5.1 Above the existing chronological list in `packages/frontend/src/components/VersionHistoryPanel.tsx`, add a `Milestones` section header (using existing section-title styling). Below it, render a list of milestones for the current path returned by `listMilestones(path)`. Each row shows the star icon, `name`, optional `description` (truncated), `createdAt` relative time, and `createdByEmail`.
- [ ] 5.2 Section is hidden entirely when `milestones.length === 0` AND the user has never created a milestone for this path (avoid taking up vertical space pre-adoption). Show an inline empty-state hint inside the panel header instead: "No milestones yet — pick a version below or save the current state."
- [ ] 5.3 Each milestone row's primary click previews the milestone content using the same read-only render pattern as preview-from-history. Banner copy: `Viewing milestone "<name>"`.
- [ ] 5.4 Each milestone row's overflow menu offers `Edit milestone…`, `Restore from this milestone…`, and `Delete milestone…`. Restore uses milestone-specific confirmation copy with the milestone name interpolated. Edit and Delete are enabled only when `createdBy === currentUser` OR the user is admin; otherwise disabled with the tooltip `Only the creator or an admin can <edit|delete> this milestone`. For orphan milestones (`createdBy === null`), only admins can edit or delete.

- [ ] 5.4b Render attribution gracefully: when `createdByEmail` is `null`, display `(deleted user)` in the muted-text style; do not render an empty string or a broken email.
- [ ] 5.5 In the chronological history list, add a `Save as milestone…` action to each row's overflow menu. Click opens `MilestoneNamingDialog` pre-populated with `fromChangeId = row.id`.
- [ ] 5.6 In the editor's toolbar (or doc-header — pick whichever already hosts the version history button), add a `Save current state as milestone…` button. Click MUST force-flush pending OT edits first (await the flush), then open `MilestoneNamingDialog` with no `fromChangeId` so the new milestone anchors to the just-created `note_changes` row. If the flush errors, surface the error and DO NOT open the dialog.

## 6. Phase 6 — MilestoneNamingDialog

- [ ] 6.1 Create `packages/frontend/src/components/MilestoneNamingDialog.tsx`. Props: `{ mode: 'create' | 'edit', path, fromChangeId?, milestoneId?, initialName?, initialDescription?, onClose, onSaved }`. Renders a small modal with a `name` input (autofocused, 80-char max, required) and an optional `description` textarea (no enforced cap).
- [ ] 6.2 In `create` mode, submit calls `createMilestone({ path, name, description, fromChangeId })`. In `edit` mode, submit calls `updateMilestone(milestoneId, { name, description })`. On 409 conflict, show inline error `A milestone named "<name>" already exists for this file`. On 400 (empty-after-trim), show inline error `Name cannot be empty`. On success, call `onSaved(milestone)` and close.
- [ ] 6.3 Visual: reuse existing modal primitives (same component used by restore-confirm, share-link, etc.). Submit button disabled while `name` is empty (after client-side trim) or while the request is pending. Submit button label is `Save milestone` in create mode and `Update` in edit mode.
- [ ] 6.4 Add snapshot tests for: create-mode happy path, edit-mode pre-population, conflict-error rendering, empty-name validation rendering.

## 7. Phase 7 — Validation & QA

- [ ] 7.1 Run `openspec validate add-file-milestones --strict` and resolve any spec-format issues.
- [ ] 7.2 Manual QA — happy path:
  - Create from current via toolbar; confirm appears in `Milestones` section
  - Create from a 5-changes-old history row; preview reproduces that exact content
  - Restore from a milestone; confirm a new history entry appears, current document content matches the milestone, and the milestone is still listed
  - Delete a milestone (as creator); confirm it disappears
- [ ] 7.3 Manual QA — pruning durability:
  - Create a milestone, then artificially shrink `VERSION_HISTORY_RETENTION_DAYS` and trigger prune (or backdate the anchor change). Confirm the milestone still previews and restores correctly. Confirm the API response now has `anchorChangeId: null` while `anchorAuthorEmail` and `anchorChangeCreatedAt` still display.
- [ ] 7.4 Manual QA — rename / delete:
  - Rename a file with milestones; confirm milestones follow the new path and remain restorable
  - Rename causing a `(path, name)` collision; confirm `409` surfaces and the rename is aborted cleanly
  - Delete a file with milestones; confirm the milestones are NOT cascade-deleted (verify via direct DB inspection)
- [ ] 7.5 Cross-editor check:
  - Inspect the vault directory after creating 5 milestones. Confirm no `.md` files, sidecars, or hidden folders were created. Open the vault in Obsidian and confirm no schema/file changes are visible to it.
- [ ] 7.6 Performance check:
  - Create 50 milestones on a single 100KB file. Confirm `listMilestones` returns in <100ms. Confirm panel render stays smooth.
- [ ] 7.7 Backup check:
  - Trigger a backup via `admin-backup-restore`. Restore on a fresh instance. Confirm milestones round-trip with content intact.

## 8. Phase 8 — Non-regression test suite

Each NR-N task corresponds to a row in the Impact Matrix in `design.md`. These verify that existing capabilities continue to behave correctly with the new feature in place. Add as automated tests where practical (unit/integration); manual QA only where automation is disproportionate.

**`change-tracking` capability**

- [ ] NR-1 Add an integration test: insert N `note_changes` rows older than retention, anchor a milestone to one of them, run `pruneVersionHistory()`, assert ALL N change rows are deleted (including the anchored one). Assert the milestone row remains and its `anchorChangeId` is now `NULL`.

**`version-reconstruction` capability**

- [ ] NR-2 Confirm the existing reconstruction unit-test suite passes unchanged after this change ships. Run: `pnpm --filter @kalepin/backend test version-history`.
- [ ] NR-3 Add an integration test: reconstruct a `changeId = N` for a path that has 5 milestones vs. the same path with 0 milestones; assert the returned content is byte-identical.

**`version-history-ui` capability**

- [ ] NR-4 Add an E2E (Playwright) test exercising the existing version-history flows (open panel, click historical row, preview, restore, close) on a file with milestones present. Assert the chronological list renders as before.
- [ ] NR-5 Add a snapshot test of `VersionHistoryPanel` rendered with: (a) zero milestones, (b) three milestones. Confirm the chronological-list section's DOM is bit-identical between the two — only the Milestones section above differs.

**`restore-safety` capability**

- [ ] NR-6 Add an integration test asserting that BOTH history-restore and milestone-restore produce a pre-restore auto-snapshot row in `note_snapshots` for the current content before applying the new content. Use the same DB fixture for both flows; assert the snapshot row exists at the correct change id in both.
- [ ] NR-7 Add an integration test: create a milestone whose content equals current; call restore; assert zero new rows in `note_changes` and `note_snapshots`, and assert the API returns `{ ok: true, newChangeId: null }`.

**`rename-tracking` capability**

- [ ] NR-8 Confirm the existing rename-tracking unit and integration tests pass unchanged with milestones absent. Run: `pnpm --filter @kalepin/backend test rename`.
- [ ] NR-9 Add an integration test: rename a file with two milestones; assert all three updates (`note_changes`, `starred_items`, `note_milestones`) commit atomically. Then induce a controlled failure on the `note_changes` UPDATE (e.g. via a transaction-time spy) and assert NONE of the three tables are updated.
- [ ] NR-10 Add a unit test for the auto-suffix logic: source has `v1`, destination has orphan `v1`; assert source becomes `v1 (renamed)` and destination's `v1` is unchanged. Repeat with destination also having `v1 (renamed)`; assert source becomes `v1 (renamed 2)`.

**`file-management` capability**

- [ ] NR-11 Add an integration test: delete a file with three milestones; assert the file is removed from disk AND the three milestone rows remain queryable by `getById`. Assert the editor panel does not surface them when no file at that path is open.
- [ ] NR-12 Confirm the file-tree listing response shape is unchanged: write a contract test asserting the JSON keys returned by `GET /files/tree` are exactly the pre-change set (no `milestones`, no `milestoneCount`, no leak).

**`ot-collaboration` capability**

- [ ] NR-13 Add an integration test mirroring the existing "restore while another user is editing" test: open two OT sessions on the same file; create a milestone from session A; restore from session B's milestone-restore call; assert session A receives the OT update and both sessions converge on the milestone content.

**`admin-backup-restore` capability**

- [ ] NR-14 Add an end-to-end backup test: create a vault with 5 files, 12 milestones (mix of from-current and from-changeId), trigger backup, wipe DB, restore from backup, assert `listByPath` for each file returns the same milestones with byte-identical `content` and unchanged `createdBy` / `createdAt`.

**`api-key-auth` / `api-key-scopes` capability**

- [ ] NR-15 Add a contract test: a request with the existing read scope (no `milestones:write`) succeeds on every pre-existing route exactly as before. Run the existing api-key test suite unchanged.
- [ ] NR-16 Add tests for the new scope enforcement: API key WITHOUT `milestones:write` returns `403` on POST/PATCH/DELETE/restore milestone routes; the same key returns `200` on GET milestone routes (read uses the existing read scope).

**`user-attribution` capability**

- [ ] NR-17 Add an integration test: create a milestone as user Alice; delete Alice's User row; assert the milestone row remains, `createdBy` is `NULL`, `content` is unchanged. Assert the API response for that milestone has `createdBy: null` and `createdByEmail: null`.

**`attachments` capability**

- [ ] NR-18 Add an integration test: create a milestone whose markdown content references an attachment; later delete the attachment via `attachment-cleanup`; restore the milestone; assert the restore succeeds (returns 200, not 422), the file content is restored byte-identical to the milestone, and the broken-link is rendered the same way the editor renders any other broken attachment link.

**`full-text-search` and `semantic-search` capabilities**

- [ ] NR-19 Add a test asserting that creating 50 milestones across various files leaves the FTS5 row count and the embeddings row count unchanged. Run before and after; assert equal.

**`external-write-sync` capability**

- [ ] NR-20 Add an integration test: create a milestone for a file; modify that file directly on disk (simulating an Obsidian edit); wait for the file watcher to record the new change; assert the milestone row is unchanged in every column.

- [ ] 8.99 Final regression sweep: run `pnpm test` on backend and frontend packages; run the existing Playwright E2E suite; confirm no failures attributable to this change. Document any tests that needed fixture updates (e.g., adding `createdBy` to user fixtures) so reviewers can verify the changes are mechanical, not semantic.
