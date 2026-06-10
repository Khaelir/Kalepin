## Why

Kalepin already records every save into `note_changes` and lets users browse / preview / restore historical versions. But all of that history is **automatic, anonymous, and ephemeral** (pruned at `VERSION_HISTORY_RETENTION_DAYS`, default 365). Users have no way to mark a moment that matters — "first draft", "submitted to client", "before the rewrite" — and rely on scrolling through a long undifferentiated list, hoping the relevant change still falls inside the retention window. Milestones add a thin curated layer over the existing history: name a state, pin it, and have it survive forever.

## What Changes

- **Backend — schema**: New `note_milestones` table with `id`, `path`, `name`, `description?`, `content` (full markdown, materialized at creation), `anchorChangeId?` (nullable FK to `note_changes`, ON DELETE SET NULL), `anchorAuthorEmail?` (denormalized snapshot), `createdBy`, `createdAt`. Unique constraint on `(path, name)`.
- **Backend — services**: New `MilestonesService` covering create-from-current-content, create-from-historical-changeId, list, get content, restore-from-milestone (writes content via OT, identical semantics to existing `/restore`), delete.
- **Backend — API**: New routes under `/api/files/milestones` (create, list-by-path, get, delete, restore).
- **Backend — pruning**: No change to `pruneVersionHistory()`. Milestones carry their own content and survive prune independently. The `anchorChangeId` FK falls to `NULL` when its `note_changes` row is pruned; `anchorAuthorEmail` is captured at milestone creation so attribution survives.
- **Backend — rename / delete**: When a file is renamed, milestones are updated to follow the new path (single `UPDATE note_milestones SET path = …`). When a file is deleted, milestones for that path are kept by default (a deleted file's milestones may still be the only proof of past content). UI surfaces "milestones for deleted file" only via admin / search; not in the editor panel.
- **Frontend — VersionHistoryPanel affordances**: Each history row gets a `⭐ Save as milestone…` action that opens a small naming dialog. The toolbar gains a `Save current state as milestone…` button.
- **Frontend — Milestones section**: The version history panel renders a pinned `Milestones` group above the chronological history list, showing `name`, `description`, `createdAt`, `createdBy`, and per-row actions (View, Restore, Delete).
- **Frontend — Restore-from-milestone**: Reuses the existing restore confirmation flow but uses `POST /api/files/milestones/:id/restore` instead of the changeId-based endpoint.
- **Deferred (not in scope)**: Auto-milestones (scheduled / every-N-saves), publish/share links to a milestone, diff between two milestones, export milestones as `.md` files, multi-user permissions beyond `createdBy`.

## Capabilities

### New Capabilities

- `file-milestones`: Persisted user-named snapshots of a note's content at a point in time, immune to history pruning. Create from current state or from any history entry; list, view, restore-from, delete.

### Modified Capabilities

- `version-history-ui`: The version history panel gains a `Milestones` section above the chronological list and a `Save as milestone` action on every history entry. The editor toolbar gains a `Save current state as milestone` button.

## Impact

- **Affected code**:
  - `packages/backend/src/entities/note-milestone.entity.ts` (new) — TypeORM entity for the new table.
  - `packages/backend/src/migrations/<timestamp>-AddNoteMilestones.ts` (new) — migration creating the table + indexes.
  - `packages/backend/src/changes/milestones.service.ts` (new) — create/list/get/restore/delete logic.
  - `packages/backend/src/changes/changes.module.ts` — register the new service + entity.
  - `packages/backend/src/files/files.controller.ts` — new milestone routes.
  - `packages/backend/src/files/files.service.ts` — wire rename to update `note_milestones.path`.
  - `packages/shared/src/models.ts` — add `Milestone` shape returned by the API.
  - `packages/frontend/src/api.ts` — typed wrappers for the five new endpoints.
  - `packages/frontend/src/components/VersionHistoryPanel.tsx` — milestone section header, list rendering, naming dialog wiring.
  - `packages/frontend/src/components/MilestoneNamingDialog.tsx` (new) — small modal for `name + optional description`.
  - `packages/frontend/src/editor/DocHeader.tsx` or toolbar component — `Save current state as milestone` button.
- **APIs**: Five new routes under `/api/files/milestones`. No changes to existing history routes. Additive.
- **Persistence**: One new SQL table (`note_milestones`). No schema changes to `note_changes` or `note_snapshots`. Storage cost ≈ one full-content row per milestone (rare, user-curated).
- **Cross-editor compatibility**: Milestones are DB-only — no markdown sidecar, no hidden folder, no frontmatter mutation. Obsidian and other editors are unaffected.
- **Pruning interaction**: None. Milestones do not depend on the `note_changes` reconstruction chain; the anchor FK is informational and falls to `NULL` gracefully on prune.
- **Backups**: The existing `admin-backup-restore` flow ships the SQLite file, so milestones are included automatically. No new backup wiring required.
