## Why

Kalepin's sidebar tree answers "where is my note?" but not "what did I change today?". Users working across sessions, devices, and collaborators need a fast way to see what's been modified recently — and a note's Created and Last-updated dates are currently invisible anywhere in the UI. Exposing modification time on the file listing unlocks both a dedicated Activity view and richer doc-header metadata, closing a visible gap once the redesign ships.

## What Changes

- **Backend**: Extend the file-tree listing response with `mtimeMs` and `birthtimeMs` per entry. Source of truth is `fs.stat()`; `birthtime` falls back to `mtime` when the filesystem reports `0` (common on Linux/Docker volumes).
- **Frontend — Activity view (new)**: Add a sidebar mode toggle (`[Vault] [Activity]`) in the sidebar head. Activity mode replaces the Vault tree with a flat list of markdown files, grouped by recency buckets (Today, Yesterday, Earlier this week, Earlier this month, Older), most-recent first within each group. Mode is persisted via the existing `tweak` state.
- **Frontend — doc-header meta row**: Add `Created <DATE>` segment to the existing meta row, before the `edited N minutes ago` segment. Extends the meta-row requirement landing in `redesign-editor-ui`.
- **Frontend — tree row hover tooltip**: On Vault-tree row hover, show a native tooltip with "updated N ago" (no visual layout change).
- **Deferred**: Filter-chips over the Vault tree, sort-by-date tree mode, per-row always-visible meta, Created-date backfill from git history. Not in scope.

## Capabilities

### New Capabilities

- `tree-activity-view`: Sidebar mode toggle and flat recency-grouped file listing, with per-row relative modification time. Persists selected mode across sessions.

### Modified Capabilities

- `file-management`: The file-tree listing response gains `mtimeMs` and `birthtimeMs` fields on every entry. No breaking change for existing consumers (additive).
- `doc-header`: The meta row gains a `Created <DATE>` segment alongside the existing `edited N minutes ago`. Depends on the base `doc-header` spec landing via `redesign-editor-ui` first.

## Impact

- **Affected code**:
  - `packages/shared/src/models.ts` — `FileEntry` gains `mtimeMs` and `birthtimeMs`.
  - `packages/backend/src/storage/local-fs.adapter.ts` — `list()` populates the new fields via `fs.stat` (or Dirent + stat).
  - `packages/backend/src/storage/git.adapter.ts` — inherits the change; no override needed.
  - `packages/backend/src/files/files.service.ts` + controller — pass the fields through.
  - `packages/frontend/src/api.ts` — type update only.
  - `packages/frontend/src/components/Sidebar/ActivityView.tsx` (new) — flat bucket list.
  - `packages/frontend/src/components/Sidebar/VaultHeader.tsx` (or adjacent) — segmented `[Vault] [Activity]` control.
  - `packages/frontend/src/components/FileTree.tsx` — add hover tooltip with relative mtime.
  - `packages/frontend/src/App.tsx` — extend `tweak` state shape (`tweak.sidebarMode: 'vault' | 'activity'`) and migration.
  - `packages/frontend/src/editor/DocHeader.tsx` (landing in redesign) — add Created segment to meta row.
  - `packages/frontend/src/utils/recent-buckets.ts` (new) — pure bucket-grouping helper.
- **APIs**: No new endpoints. The `GET /files/tree` response shape changes additively.
- **Dependencies**: No new runtime deps.
- **Persistence**: `tweak.sidebarMode` added to the existing `localStorage['kalepin-tweaks']` payload (version bump handled by the existing migration path).
- **Perf**: `list()` currently does recursive `readdir` (O(n)). Adding `stat` per entry is O(n) extra syscalls; expected overhead is tens of ms on a 5k-file vault. Benchmarked during implementation; if meaningful, switch to `opendir` + `Dirent.stat()` or parallelize per directory.
- **Ordering constraint**: This change depends on `redesign-editor-ui` for (1) the sidebar CSS scaffold (`.kp-node`, `--kalepin-*` tokens) used by Activity view rows, and (2) the `doc-header` spec the Created segment extends. Backend work is independent and can start immediately; frontend work lands after `redesign-editor-ui` archives.
- **Existing `RecentSection` (visit-based, localStorage)** is orthogonal and stays as-is. Activity view uses server-side `mtime` — a note edited by a collaborator or by Obsidian on another device shows in Activity but not in Recent.
