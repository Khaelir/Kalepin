# Implementation Handoff — add-file-milestones

Status: **postponed**. Spec and tasks are written; implementation has not started. This note records mismatches found between the spec and the current codebase so the next implementer can resolve them up front rather than mid-implementation.

Read this in conjunction with `proposal.md`, `design.md`, `tasks.md`, and `specs/`.

## Mismatches between spec and codebase

These were uncovered while preparing to apply the change. Each one needs a decision before coding starts.

### 1. No migrations system

- **Spec assumes:** Tasks 1.2 and 1.5 require writing a TypeORM migration file at `packages/backend/src/migrations/<timestamp>-AddNoteMilestones.ts` and running `pnpm typeorm migration:run`.
- **Reality:** `packages/backend/src/app.module.ts:36` sets `synchronize: true`. There is no `migrations/` directory and no migration script in `packages/backend/package.json`. Schema evolves automatically from entity definitions.
- **Resolution options:**
  - **(a)** Drop tasks 1.2 and 1.5. The entity gets picked up via `TypeOrmModule.forFeature([..., NoteMilestone])` in `changes.module.ts`; `synchronize: true` creates the table. Update `tasks.md` accordingly.
  - **(b)** Introduce a migrations system as a *separate* prerequisite change. Out of scope here.
- **Recommendation:** (a). Match existing convention.

### 2. No FK constraints in existing entities

- **Spec assumes:** Task 1.1 declares foreign keys `anchorChangeId` → `note_changes.id` and `createdBy` → `User.id`, both with `ON DELETE SET NULL`. Decisions 3 and 13 in `design.md` lean on this behavior.
- **Reality:** `note-change.entity.ts`, `starred-item.entity.ts`, etc. use plain integer columns (e.g. `@Column({ type: 'integer' }) userId!: number | null`). No `@ManyToOne`, `@JoinColumn`, or `onDelete` declarations exist anywhere. SQLite + `synchronize: true` means FKs would only matter if explicitly written into the entity.
- **Resolution options:**
  - **(a)** Match existing convention: plain integer columns; clean up `createdBy` and `anchorChangeId` at the application layer when a user or note_change row is deleted. Adds a small amount of work in the User-deletion and prune paths.
  - **(b)** Introduce real FK relations on the new entity only. Mixed convention; first entity in the codebase to use them. Behavior under SQLite + synchronize needs verification.
- **Recommendation:** (a). Update `design.md` Decisions 3 and 13 to say "application-level SET NULL on user/note_change deletion" and add explicit tasks to wire those code paths.

### 3. Rename is not transactional today

- **Spec assumes:** Task 2.3 and NR-9 require updating `note_milestones.path` "inside the same transaction" as `starred_items` and `note_changes`, with rollback on partial failure.
- **Reality:** `packages/backend/src/files/rename-tracking.service.ts:47-77` performs sequential `await`s on independent repositories with no transaction wrapping. There is currently no atomicity guarantee across `starred_items`, `note_changes`, and `share_links`.
- **Resolution options:**
  - **(a)** Wrap the existing handler in a `DataSource.transaction(...)` and add `note_milestones` updates inside it. This is a behavioral change to existing code (rename now rolls back on partial failure) — desirable but should be called out as a refactor with its own QA checklist.
  - **(b)** Match existing pattern: add `note_milestones` update as another sequential `await`. Not transactionally atomic, but consistent with what's already shipped. Drop NR-9's atomicity assertion.
- **Recommendation:** (a) with explicit acknowledgement in `tasks.md` that this also tightens the existing `note_changes` + `starred_items` rename behavior. Worth doing once.

### 4. No `ChangesService.restoreFromContent(...)` helper

- **Spec assumes:** Task 2.1 says `restore()` "applies `content` via the same OT-write path used by restore-from-history (`ChangesService.restoreFromContent(path, content)`-style helper)". Decision 4 in `design.md` is built on reusing this helper.
- **Reality:** The restore logic is inlined in `packages/backend/src/files/files.controller.ts:137-196` (~60 lines: reconstruct → check identical → pre-snapshot → build OT delete+insert → apply → broadcast). No service method extracts this.
- **Resolution options:**
  - **(a)** Extract the inline restore logic into a service helper (`OTService.restoreFromContent(path, content, userId)` or similar) as a prerequisite step in Phase 2. Existing `POST /api/files/restore` then calls it; milestone restore calls it too. Pure refactor; `restore-safety` semantics preserved by construction.
  - **(b)** Duplicate the logic in `MilestonesService.restore()`. Faster but creates two code paths for OT-restore — exactly the regression risk Decision 4 was trying to avoid.
- **Recommendation:** (a). Add a new task **2.0** before 2.1: "Extract OT restore-from-content logic from `files.controller.ts` into a reusable service helper. Existing `POST /api/files/restore` route delegates to it; behavior unchanged. Add unit tests covering the extracted helper."

### 5. File-naming nit

- **Spec mentions:** `rename-path.service.ts` (in tasks 2.3 and design.md Decision 5).
- **Reality:** The file is `packages/backend/src/files/rename-tracking.service.ts`.
- **Resolution:** Update the spec text to reference the actual filename. No code change needed.

## Concrete edits required to `tasks.md` before implementation

1. **Remove** task 1.2 (write TypeORM migration) and task 1.5 (run migration). Replace with a single task: "Verify the new entity is picked up by `synchronize: true` against a scratch dev DB by booting the backend and inspecting `note_milestones` schema with `sqlite3 .schema`."
2. **Insert** a new task **2.0** at the top of Phase 2: "Extract OT restore logic from `files.controller.ts:137-196` into a service helper. Existing `/restore` route delegates to the helper; behavior unchanged. Add unit test for the helper."
3. **Rewrite** task 2.3 to point to `rename-tracking.service.ts` (not `rename-path.service.ts`) and to acknowledge that this task also wraps the existing `starred_items` + `note_changes` updates in a `DataSource.transaction(...)` — the milestone update joins the transaction rather than being added alongside non-transactional code.
4. **Add** to task 1.1: "Use plain integer columns for `anchorChangeId` and `createdBy`, matching existing entity convention. The `ON DELETE SET NULL` semantics are enforced at the application layer (see new tasks 2.6 and 2.7 below) rather than via SQL constraints."
5. **Add** task **2.6**: "When a `User` row is deleted, update `note_milestones.createdBy = NULL` for any milestones that user created. Add to whatever code path handles user deletion (find via grep for `userRepo.delete\|userRepo.remove`)."
6. **Add** task **2.7**: "When a `note_changes` row is pruned in `pruneVersionHistory()`, update `note_milestones.anchorChangeId = NULL` for any milestones referencing it. NR-1 already verifies the resulting state; this task implements it."

## Concrete edits required to `design.md`

1. **Decision 3** rewrite the FK paragraph: "the FK is declared as a plain integer column with no DB-level FK constraint (matching existing entities). Application-level cleanup in `pruneVersionHistory()` sets `anchorChangeId = NULL` when the referenced change is pruned."
2. **Decision 5** update filename reference from `rename-path.service.ts` to `rename-tracking.service.ts`. Add a sentence: "This change also wraps the existing `starred_items` + `note_changes` rename updates in a `DataSource.transaction(...)` — atomicity is a new guarantee delivered alongside this feature."
3. **Decision 13** rewrite the FK paragraph: "`createdBy` is a plain integer column. On user deletion, an application-level cleanup path sets `createdBy = NULL` for milestones the user created."
4. **Decision 4** add a sentence: "The shared OT-restore helper is extracted from the existing `/restore` controller as a prerequisite refactor (task 2.0). Both restore paths route through it."

## What was *not* checked

- Whether `User.isAdmin` (or equivalent) exists for the admin checks Decisions 11 and 13 rely on. **Verify before Phase 3.**
- Whether `RequiredScope` decoration supports composite scopes or whether `milestones:write` needs to be added to `ApiKeyScope` union in `packages/backend/src/auth/permissions.ts`. **Verify before task 3.2.**
- Whether the OT service exposes a "force-flush pending edits" call that the toolbar action (task 5.6) can `await`. The decision text in §9 assumes one exists. **Verify before task 5.6.**

These three are the next preflight checks. They don't change the design; they do confirm that the design is buildable as written.

## Recommended order of resumption

1. Verify the three "not checked" items above. If any of them fails, escalate to a design-update before continuing.
2. Apply the `tasks.md` and `design.md` edits listed above.
3. Run `openspec validate add-file-milestones --strict` to confirm the spec still parses.
4. Begin Phase 1 implementation.

The spec is fundamentally sound — `proposal.md` and the 16 design decisions are well-reasoned and worth preserving. The issues above are surface-level mismatches with codebase conventions, not flaws in the design itself.
