## Context

Kalepin's history layer (capabilities `change-tracking`, `version-reconstruction`, `version-history-ui`) records every save as a unified diff in `note_changes`, takes a full snapshot every 20 changes into `note_snapshots`, and prunes both tables daily after `VERSION_HISTORY_RETENTION_DAYS` (default 365). The `VersionHistoryPanel` lets users list, preview (via diff replay) and restore any retained change. Restore writes the historical content as a new OT operation — it appends, never truncates.

This change adds a thin **user-curated** layer on top: named milestones that survive pruning, are addressable across the lifetime of a file, and remain valid regardless of what happens to the underlying change-history rows.

## Goals / Non-Goals

**Goals:**
- Let users mark and name moments in a file's life ("v1", "submitted-to-client") without scrolling through history.
- Guarantee a milestone, once created, is recoverable forever — independently of `VERSION_HISTORY_RETENTION_DAYS`.
- Reuse the existing restore semantics so milestone-restore behaves identically to history-restore (appends a new change, never truncates).
- Stay invisible to other markdown editors. Cross-editor compatibility (Obsidian) is non-negotiable.
- Ship the smallest viable product: variant B (pin + name), not branching, not publishing.

**Non-Goals:**
- Auto-milestones (every Monday, every Nth save). Worth doing later but separate scope.
- Diff viewer between two milestones, or between a milestone and HEAD. Out of scope; tracked as a follow-up.
- Public share links to a milestone. Out of scope.
- Export milestones as `.md` files in a hidden folder. Considered and rejected for v1 (see Decision 1).
- Multi-user permissions beyond `createdBy` (no roles, no per-milestone ACL).
- Branching (parallel timelines from a milestone). Conflicts with single-file-on-disk; out of scope.

## Decisions

### 1. DB-canonical, not on-disk-files

**Decision**: Milestones live entirely in the SQLite DB (`note_milestones` table). No `.md` files written to disk, no hidden folder, no frontmatter mutation.

**Why**:
- The existing `note_changes` and `note_snapshots` are already DB-only. The principle "the note is the file; metadata about the note is the DB" is consistent.
- Disk-files would let foreign editors (Obsidian, sync conflict resolvers, Time Machine restores) silently mutate or delete milestones — defeating immutability.
- Rename / delete coupling: a hidden `.kalepin-milestones/<path>/v1.md` folder needs to be kept in sync with every rename and delete the user does in another editor. The DB approach handles rename in a single `UPDATE`.
- Atomicity: milestone creation is one INSERT, transactionally consistent with everything else. Disk + DB requires two-phase write with reconciliation.

**Alternatives considered**:
- `.md` files in a dot-prefixed hidden folder, addressable as `<vault>/.kalepin-milestones/<path>/v1.md`. Rejected for the reasons above.
- Frontmatter labels on the live `.md` file (e.g. `milestones: [v1: <hash>]`). Rejected — pollutes the canonical markdown for other editors and only handles milestones-of-the-current-state, not historical ones.
- Hybrid (DB canonical + auto-export to disk on every milestone). Deferred. Plain "Export milestones to `.md`" admin action is a future option that keeps DB as source of truth.

### 2. Milestones are self-contained (materialize content), not pointers

**Decision**: Each `note_milestones` row stores the full markdown `content` at creation time, not just a foreign key into `note_changes`. The `anchorChangeId` FK is informational and nullable.

**Why**:
- A pure-pointer design (just an FK to a `note_changes` row) requires the entire reconstruction chain — nearest snapshot + all intermediate diffs — to remain unpruned for the milestone to be viewable. Either we add complex chain-protection logic to `pruneVersionHistory()`, or we change the pruner to skip rows referenced by milestones (which then transitively skips snapshots and intermediate diffs — more bookkeeping).
- Materializing content makes the milestone a fully self-contained artifact: no replay, no pruner coordination, no schema-coupling to the changes layer. Restore-from-milestone is a single SELECT + OT write.
- Storage cost is small: milestones are user-curated (rare). A 50KB note × 10 milestones = 500KB. Negligible vs. the existing periodic snapshots.

**Alternatives considered**:
- Pure FK with chain-protection in pruner (mark all `note_changes` and `note_snapshots` referenced by any milestone's reconstruction path as `pruneProtected = true`, skip them). Rejected — couples two subsystems through pruning logic; future schema changes can silently re-introduce dangling-pointer bugs.
- FK + lazy materialization (compute and cache content on first read after a prune). Rejected as a performance optimization on a feature that doesn't need it.

### 3. `anchorChangeId` is nullable + ON DELETE SET NULL; `anchorAuthorEmail` denormalized

**Decision**: The FK to `note_changes` exists for display and audit — "this milestone was taken at the change Alice made on April 30" — but is not load-bearing. When the anchored change is pruned, the FK falls to `NULL`. The author's email is denormalized into `note_milestones.anchorAuthorEmail` at creation so attribution survives.

**Why**:
- Decision 2 already makes the milestone self-contained for content; the anchor is purely informational.
- Denormalizing the author email at creation costs nothing and preserves attribution past the retention window.
- Setting `anchorChangeId = NULL` on delete is the natural Postgres/SQLite semantics for an informational FK.

**Open subdecision**: Should the milestone also denormalize `anchorChangeCreatedAt` (the original change timestamp)? Probably yes — same rationale. Captured in tasks.md.

### 4. Restore-from-milestone is a thin wrapper over the existing restore

**Decision**: `POST /api/files/milestones/:id/restore` reads `content` from the milestone, then calls into the same OT-write path used by the existing `POST /api/files/restore`. Behavior is identical: a new `modified` change is recorded with the restore diff, the pre-restore content is preserved as that new change's "previous" state, the restored content becomes the live document.

**Why**:
- Restore semantics already correct: appends, never truncates, surfaces in change history. Replicating them here is a code-reuse win, not a new design problem.
- A milestone's restore appearing in history (as "Restored from milestone v1") gives the user a coherent timeline.

### 5. Milestones survive file rename; preserved (orphaned) on file delete

**Decision**:
- **Rename**: Rename is detected by chokidar (`unlink` + `add` correlation) per the `rename-tracking` capability. The shared rename-path service is extended to update `note_milestones.path` in the same transaction it updates `starred_items` and `note_changes`. Folder renames propagate by prefix-rewrite, identical to existing path-update semantics.
- **Rename collision**: If a milestone at the destination path already exists with the same `name` (rare — typically an orphaned milestone from a previously deleted file), the rename-path service SHALL auto-suffix the incoming milestone's name with a disambiguator (`<name> (renamed)`, then `<name> (renamed 2)`, … until unique). The rename SHALL NOT be aborted. A warning is logged. We CANNOT return `409` here because the filesystem rename has already happened — chokidar reports it; we react.
- **Delete**: When a file is deleted, milestones for that path are NOT cascade-deleted. They become orphans, only reachable via admin / search, not the editor panel (no file is open at that path).

**Why**:
- Rename: milestones are clearly "of this file" — they should follow it.
- Rename collision via auto-suffix: silently dropping milestones is silent data loss; aborting the rename is impossible (the file is already at the new path on disk). Auto-suffixing preserves both milestones and surfaces the conflict via a logged warning, giving the user the chance to clean up via the editor panel.
- Delete: a deleted file's milestones may be the **only** surviving record of past content (especially after history is pruned). Hard-deleting them removes a recovery path. We accept the cost of orphan rows; cleanup is an admin concern.
- Deferred: an admin "milestones for deleted files" view. Out of scope; orphaned milestones will accumulate slowly enough that this is a year-2 problem.

**Alternatives considered**:
- Cascade delete on file removal — rejected; loses recovery path.
- Soft-delete the file but keep milestones — outside our model (we don't soft-delete files).
- Abort the rename on milestone-name collision — impossible; the rename is observed, not requested.
- Drop the colliding milestone (source or destination) silently — rejected; silent data loss.

### 6. Unique `(path, name)`, names are user-free-text

**Decision**: A milestone's `name` is user-supplied free text (max 80 chars), unique within a path. Two files can both have a `v1`. The same file cannot have two `v1`s.

**Why**:
- Free text covers `v1` / `vsemver` / `submitted-to-client` / `before-the-rewrite` without imposing structure.
- Per-path uniqueness gives a stable handle for restore-by-name (future API niceness) without preventing reuse across the vault.
- Optional `description` field for the longer "what was this milestone for" annotation; no length cap beyond practical TEXT limits.

**Edge case (creation)**: A `POST /api/files/milestones` with a `name` that already exists for the path returns `409 Conflict`. The user retries with a different name.

**Edge case (rename)**: Rename collisions are handled by the rename-path service via auto-suffix — see Decision 5. We do NOT return `409` on rename because the filesystem rename has already happened.

### 7. UI surface: pinned section in the existing panel + toolbar action

**Decision**: The `VersionHistoryPanel` gets a `Milestones` group rendered above the chronological list. The editor toolbar gains a single "Save current state as milestone" action. Each history row in the chronological list gains a "Save as milestone…" affordance on hover / context menu.

**Why**:
- Reuses the panel users already know — no new top-level UI surface.
- Two creation paths cover the two real flows: (a) "I want to mark right now" (toolbar), (b) "I want to mark that thing I wrote yesterday" (history row action).
- Pinning the Milestones group above the chronological list reflects their semantic priority — they're the curated surface, history is the firehose.

### 8. No diff-with-current view in v1

**Decision**: Viewing a milestone uses the existing read-only preview pattern (banner + read-only TipTap render of the milestone content). No side-by-side diff against the current document.

**Why**: A diff viewer is independently valuable for ALL of history, not just milestones. Coupling its design to milestone delivery would inflate scope. Tracked as a follow-up; landing it later automatically benefits both surfaces.

### 9. Toolbar action flushes before milestoning ("flush-then-milestone")

**Decision**: The toolbar `Save current state as milestone…` action SHALL force-flush any pending OT edits to disk first, then create the milestone from the just-flushed content. The naming dialog opens after the flush completes.

**Why**:
- Three candidate semantics: (A) milestone the last-saved disk state, (B) milestone the in-memory editor buffer, (C) flush, then milestone the freshly-saved state.
- (A) is incorrect from the user's perspective — clicking "current state" and getting a 5-minute-old version is broken.
- (B) introduces a state the filesystem may never see: if the flush later fails or the browser closes, the milestone captures content with no corresponding `note_changes` row. The anchor FK becomes meaningless and the timeline is incoherent.
- (C) guarantees every milestone corresponds to a state that **also** exists as a normal `note_changes` row, with a real anchor changeId. Cost: ~100ms of flush latency before the dialog opens. Negligible.

**Implication for the API**: The `POST /api/files/milestones` endpoint with no `fromChangeId` reads disk content and captures the most-recent `note_changes` row as the anchor. The frontend's responsibility is to ensure that "most recent change" reflects the user's current edits — done by force-flushing before the API call.

**Implication for failure modes**: If the flush itself fails, the toolbar action SHALL surface the flush error and NOT open the naming dialog. The user retries after resolving the underlying save problem.

### 10. Mutability — content immutable, name + description editable

**Decision**: Once created, a milestone's `content` SHALL NOT be modifiable via any API. The `name` and `description` fields ARE editable via `PATCH /api/files/milestones/:id`. Anchor fields (`anchorChangeId`, `anchorChangeCreatedAt`, `anchorAuthorEmail`, `createdBy`, `createdAt`) are also immutable.

**Why**:
- The whole point of a milestone is "frozen at this moment". Editable content would silently invalidate every previous reference to the milestone — including any prior `restore` that put that content into history. A contract that "v1 means whatever Alice last edited it to" is no contract at all.
- Editable `name` covers the typo case (`v1 ` → `v1`) without forcing delete-and-recreate, which would lose `createdAt` and the anchor metadata.
- Editable `description` covers the "annotate after the fact" case ("oh, this is what I sent to Marc on April 15"). Annotation is a well-understood pattern that doesn't compromise immutability of the artifact itself.
- Per-path uniqueness on `name` SHALL be re-checked on PATCH; conflict returns `409`.

### 11. Visibility — public per-file read, restricted edit/delete

**Decision**: Milestones are **public per-file**: any user with read access to a file SHALL be able to list, view, and restore from that file's milestones. Edit (PATCH) and delete SHALL be restricted to the milestone's `createdBy` user OR a user with admin privileges.

**Why**:
- Aligns with `change-tracking` and `version-history-ui`: history rows are already author-attributed AND visible to all users with file-read access. Restricting visibility would diverge from the established mental model.
- The use case "I want to mark a moment that the team can refer to / restore from" is far more common than "I want a personal bookmark only I can see". Personal bookmarks would be a different feature.
- Edit/delete restriction protects against drive-by name-changes by other users on milestones they didn't create.

### 12. Name validation — trim whitespace, reject empty after trim

**Decision**: The API SHALL trim leading/trailing whitespace from `name` on create and edit. After trimming, an empty `name` SHALL be rejected with `400 Bad Request` (not `409`). The trimmed value is what is stored and what participates in the unique `(path, name)` constraint.

**Why**:
- `v1` and `v1 ` are the same milestone in user mental models. Treating them as different would surface as confusing duplicate-name errors.
- Empty names are not addressable — they break the "say `v1` to mean this milestone" affordance. Rejecting them at the boundary is cleaner than allowing and degrading later.
- `400` (validation) vs `409` (conflict) — the empty-name case is a malformed request, not a uniqueness failure.

### 13. `createdBy` on user deletion → SET NULL

**Decision**: The FK from `note_milestones.createdBy` to `User.id` SHALL be `ON DELETE SET NULL`. Milestones whose creator has been deleted SHALL display `Created by (deleted user)` in the UI and SHALL still be readable, restorable, and deletable (by admins).

**Why**:
- A milestone's value is its content + name + timestamp; the creator's identity is metadata. Losing the user shouldn't lose the milestone.
- `RESTRICT` would prevent user deletion as long as any milestone exists, which is operationally annoying for off-boarding.
- Milestones with `createdBy = NULL` need an admin-only delete escape hatch (Decision 11 already covers this — admins can delete anything).

### 14. MCP tool surface — out of scope for v1

**Decision**: The MCP tool registry SHALL NOT expose milestone create/restore/delete tools in v1. The HTTP API is fully usable by any API-key client (including AI assistants that can call HTTP), but no `mcp_create_milestone` etc. tools are registered.

**Why**:
- AI assistants creating milestones is a useful future capability ("Claude, mark this version as 'v1 draft'") but adds product surface area we haven't validated.
- The HTTP API is the contract; MCP tools are a thin wrapper. We can add wrappers in a follow-up without breaking anything.
- Keeps the v1 scope focused on the user-driven flow.

### 15. Restore-no-op when content identical — inherited from `restore-safety`

**Decision**: `POST /api/files/milestones/:id/restore` SHALL inherit the existing `restore-safety` semantics: if the milestone's `content` is byte-identical to the file's current on-disk content, no OT operation is issued and no new `note_changes` row is created. The endpoint returns success with `newChangeId: null`.

**Why**:
- The `restore-safety` capability already handles this for history-based restore (`Scenario: Restore of content identical to current` — no changes applied, no new history entries created).
- Diverging from this would surprise users and pollute history with no-op rows.
- Implementation falls out for free if we route through the same `ChangesService.restoreFromContent(...)` helper.

### 16. Search corpus — milestones not indexed

**Decision**: Milestone `content` SHALL NOT be added to the FTS5 search index or the semantic-search vector index. Search continues to operate on current file content only.

**Why**:
- Search returns "where does X exist in my vault" — adding milestone content would surface stale historical phrases as hits, confusing the navigation model.
- Index size scales with milestone count; uncontrolled growth for a power user with hundreds of milestones is undesirable.
- "Find a phrase from a past milestone" is a different feature (search-within-history) that's worth designing as its own thing if requested.

## Impact Matrix

This change touches several existing capabilities. For each, we describe the touch-point, the regression we want to prevent, and the test that verifies non-regression. Concrete tasks live in `tasks.md` Phase 8.

| Capability | Touch-point | Regression risk | Non-regression verification |
|---|---|---|---|
| `change-tracking` | New table sits alongside `note_changes`; pruner unchanged. | Pruning of `note_changes` could be inadvertently skipped if a future patch confuses milestone-anchor with prune-protect. | NR-1: `pruneVersionHistory()` deletes change rows older than retention regardless of whether any milestone anchors them. Confirm via in-memory DB test. |
| `version-reconstruction` | Reconstruction service is reused inside `MilestonesService.createFromChange()`; no edit to the service itself. | Reconstruction-from-history could regress if we accidentally couple it to milestone state. | NR-2: existing reconstruction unit tests pass unchanged. NR-3: reconstruction of a `changeId` whose path has milestones returns the same content as for a path without milestones. |
| `version-history-ui` | Panel gains a Milestones section above the chronological list; per-row "Save as milestone…" affordance. | Chronological list could regress if rendering shares a list state. Restore confirmation could regress if we share a single modal. | NR-4: existing version-history E2E flows (open panel, click row, preview, restore, close) pass with milestones present and absent. NR-5: chronological list ordering and content rendering bit-identical with vs. without milestones. |
| `restore-safety` | Restore-from-milestone routes through the same OT-write helper; inherits the auto-snapshot-current-before-apply and no-op-when-identical semantics. | The helper could regress (diverge) if milestone restore introduces a parallel code path. | NR-6: pre-restore auto-snapshot exists for both history-restore and milestone-restore (assert via DB inspection in integration test). NR-7: restoring a milestone whose content equals current produces zero new rows in `note_changes`. |
| `rename-tracking` | Rename-path service extended to update `note_milestones.path` in the same transaction. Folder renames propagate via prefix rewrite. | Existing `note_changes` and `starred_items` updates could regress if the service refactor breaks them. Auto-suffix logic could leak into single-row case. | NR-8: existing rename tests for `note_changes` and `starred_items` pass with milestones absent. NR-9: rename with milestones present updates milestone path in the same transaction; partial failure rolls back all three tables. NR-10: rename collision auto-suffixes only the conflicting milestone, leaves siblings unchanged. |
| `file-management` | File deletion does NOT cascade to milestones. Listings unchanged. | A future "tidy" sweep could decide to delete orphaned milestone rows; we'd lose recovery paths. Listings could leak the new table accidentally. | NR-11: deleting a file leaves milestone rows for that path queryable. NR-12: file-tree listing response shape unchanged (no milestone fields leaked). |
| `ot-collaboration` | Restore-from-milestone applies content via OT; concurrent editor sees the change in real-time. Inherits existing semantics. | Restore-from-milestone could bypass OT broadcasting if it took a shortcut. | NR-13: integration test mirroring the existing "restore while another user is editing" history-restore test, with a milestone restore — both users converge on the milestone content. |
| `admin-backup-restore` | Backup is the SQLite file; milestones round-trip with the DB. | Backup format could miss the new table if it's enumerated by hard-coded names somewhere. | NR-14: backup → restore on a fresh instance preserves all milestone rows including content, anchors, and `createdBy`. |
| `api-key-scopes`, `api-key-auth` | New `milestones:write` scope; milestone-list/get reuse the existing read scope. | Existing scope checks could regress if the new scope is registered incorrectly. | NR-15: API-key requests with the existing read/write scopes work unchanged for non-milestone routes. NR-16: a key without `milestones:write` is denied on POST/PATCH/DELETE/restore but allowed on GET. |
| `user-attribution` | `note_milestones.createdBy` is a new FK to User; SET NULL on user delete. | User deletion flow could regress if RESTRICT is accidentally chosen. | NR-17: deleting a user who created milestones succeeds; their milestones remain with `createdBy = NULL`. |
| `attachments` | Milestone `content` may reference attachments via markdown links; references can become broken if attachments are later cleaned up by `attachment-cleanup`. | Milestone-restore could fail if it tries to validate attachment references. | NR-18: milestone with broken attachment links is restorable; UI renders the broken-link state without erroring. (Same behavior as a current note with broken links — milestones inherit the rule.) |
| `full-text-search`, `semantic-search` | Milestone content NOT indexed (Decision 16). | Indexer could accidentally include milestone content if it iterates `*` on a shared writer interface. | NR-19: FTS5 row count and semantic-search vector count unchanged after creating 50 milestones. |
| `external-write-sync` | A user editing the underlying `.md` from another editor doesn't affect milestones (DB-only). | A future sync mechanism could try to "sync" milestones to disk and break Decision 1. | NR-20: editing the `.md` directly on disk creates new history rows but does NOT alter any existing milestone row. |

## Risks / Trade-offs

- **[Storage] Materialized content duplicates note text** → Worst case: a 100KB note × 50 milestones = 5MB per file. Acceptable for a user-curated feature; mitigated by the 80-char name budget surfacing UX friction at high milestone counts. Revisit if real-world usage shows >100 milestones per file.

- **[UX] Free-text names allow user-induced confusion** → Two files can both have `v1`; a single file cannot. We could enforce a stricter scheme (semver, auto-increment) but free text is more useful for prose. Surface the per-path uniqueness violation with a clear `Name already exists` inline error.

- **[Migration] Adding a new table mid-stream** → Standard TypeORM migration. Existing data unaffected. Rollback = drop the table.

- **[Orphan accumulation] Milestones for deleted files persist** → Will grow over time. v1 ignores it; an admin "orphaned milestones" cleanup view is a deferred follow-up. Worst-case scaling: a power user creating a milestone per file and deleting the files would accumulate one row per ex-file, indefinitely. Not realistic in observed usage.

- **[Cross-device sync] DB-only milestones don't reach Obsidian on another device** → Correct by design. If a user wants their milestones in Obsidian, they're asking for the export feature, which is a deferred scope item.

- **[Rename collision] `(path, name)` uniqueness can collide during rename** → Rename is chokidar-driven (filesystem event, not API request) so we cannot return `409` after the fact. The rename-path service auto-suffixes the colliding milestone (`<name> (renamed)`) and logs a warning. Both milestones survive; the user resolves the cosmetic suffix later.

- **[Authorization] PATCH/DELETE rules diverge from list/get/restore** → Milestones are public per-file for read and restore, restricted to creator+admin for edit and delete (Decision 11). Mirroring how history is "everyone reads, attribution shows", but adds two distinct authorization paths. Documented in spec; tested in NR-15/16.

- **[User deletion] `createdBy = NULL` rows accumulate** → Milestones outlive their creators by design (Decision 13). UI must handle NULL gracefully ("Created by (deleted user)") in every spot it displays attribution. Verified in NR-17.

## Migration Plan

1. **Migration ships first**: a single TypeORM migration adds the `note_milestones` table + indexes. Existing data untouched. Safe to deploy with no client coordination.
2. **Backend services + routes ship next**: API surface live but unused. No regression risk to existing history/restore flows.
3. **Frontend ships last**: `VersionHistoryPanel` updated to render the Milestones section and naming dialog. Toolbar action wired. Default behavior unchanged for users who never create a milestone.
4. **Rollback**: Frontend can be reverted independently. Backend rollback drops the table (after backing it up — milestones are user data and a regretted ship should preserve them).

## Open Questions

- Should the milestone's `description` support markdown rendering, or stay plain text? Defaulting to plain text in v1; revisit if users start packing markdown into the field anyway.
- Surface milestone count next to the file in the sidebar tree? Useful but adds a per-file query / index. Defer until milestone usage data exists.

## Resolved (recorded for traceability)

- **Auto-milestones in v1?** No. Milestones are exclusively manual (toolbar or per-history-row action). Scheduled / every-N-saves / on-publish auto-creation is a separate follow-up.
- **Toolbar "Save current state as milestone" semantics?** Flush-then-milestone (Decision 9). The action force-flushes pending edits, then milestones the just-saved state.
- **Restore confirmation copy** — Use milestone-specific copy referencing the milestone name, not the generic restore-from-history copy. Wired in tasks 5.4 and Phase 7 QA.
- **Mutability after creation?** Content + anchor fields immutable; `name` and `description` editable via `PATCH` restricted to creator + admin (Decision 10).
- **Multi-user visibility?** Public per-file for read and restore; creator + admin for edit and delete (Decision 11).
- **Whitespace and empty-name handling?** Trim on input; reject empty-after-trim with `400` (Decision 12).
- **`createdBy` user deletion semantics?** `ON DELETE SET NULL`; orphan attribution rendered as `(deleted user)` (Decision 13).
- **MCP tool surface in v1?** Out of scope; HTTP API is the contract (Decision 14).
- **Restore of identical content?** No-op, inherited from `restore-safety` (Decision 15).
- **Milestone content in search index?** Not indexed (Decision 16).
- **Rename collision behavior?** Auto-suffix colliding source milestone; do NOT return `409` (since rename is chokidar-driven). Decision 5 / Decision 6.
