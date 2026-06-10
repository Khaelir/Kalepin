## Context

The sidebar today renders a recursive folder tree (`components/FileTree.tsx`). Recency is only visible via the `RecentSection` (localStorage visits on this client). The backend has `fs.stat()` wired for individual files via `LocalFSAdapter.stat()` but the `list()` response drops timestamps. The in-flight `redesign-editor-ui` change establishes a new sidebar scaffold (`.kp-node` rows, `--kalepin-*` tokens), a doc-header with a meta row, and a `tweak` state blob persisted to `localStorage`.

This change extends that visual system to surface a flat recency view and modification dates, using filesystem `mtime` as the source of truth (source-agnostic: OT flushes, git pulls, external editor syncs all update `mtime`).

## Goals / Non-Goals

**Goals:**
- One click from "Vault tree" to "what changed recently", without losing the tree view.
- Collaboration-friendly: edits by other clients (including Obsidian on another device) show up without the current client having opened the file.
- Cheap backend change: reuse existing `fs.stat` — no new watcher, no sidecar, no git log per file.
- Surface Created and Last-updated on the open doc's header.
- Degrade gracefully on filesystems where `birthtime` is unreliable.

**Non-Goals:**
- A date filter chip overlaid on the Vault tree. (Considered; rejected — half-expanded trees for "orphan" folders are worse UX than a flat list.)
- A sort-by-date mode on the Vault tree. (Considered; rejected — still forces users to scan the whole tree.)
- Backfilling Created date from git log for existing files. (Considered; rejected — O(commits) per file, and `birthtime ?? mtime` is good-enough.)
- Changing the visit-based `RecentSection` — stays as-is, semantically different from Activity view.
- Always-visible per-row meta in the Vault tree. (Considered; rejected — row is already dense. Hover tooltip covers the low-value case.)
- Mobile/tablet behavior. Out of scope, matches redesign.

## Decisions

### 1. Flat Activity view (mode toggle) over tree-filter or sort modes

**Decision**: Sidebar gets a `[Vault] [Activity]` segmented control. Activity swaps the tree for a flat list grouped into buckets.

**Why**: The user question behind this feature is "what did I work on?" — hierarchy is noise for that question. VS Code Timeline, Obsidian's Recent Files plugin, and most note-taking tools converge on the same pattern. A filter-chip over the tree produces orphan folders and empty states; a sort-by-date mode still forces scanning the full tree.

**Alternatives considered**:
- Filter chips above the tree (Today · Week · Month · All) — rejected above.
- Sort-by-mtime tree mode — rejected above.
- Add "edited" dates to every tree row — rejected; row is already dense. Covered by hover tooltip only.

### 2. `fs.mtime` / `fs.birthtime` as source of truth, returned from `list()`

**Decision**: Extend `LocalFSAdapter.list()` to populate `mtimeMs` and `birthtimeMs` from `fs.stat`. `GitAdapter` inherits. `FileEntry` gets the new optional fields.

**Why**: Source-agnostic (OT writes, `git pull`, external editors all bump `mtime`). Zero new infrastructure. The `stat()` method already exists for single files; extending `list()` is an O(n) syscall expansion during an already-recursive walk.

**Alternatives considered**:
- Git log `--diff-filter=A` for Created — accurate but O(commits) per file; rejected for scale.
- Sidecar metadata files — yet another schema; rejected.
- Wrap every write to record `updatedBy` + `updatedAt` in the sidecar — adds coupling, requires migration.

### 3. `birthtimeMs` fallback chain

**Decision**: When a filesystem reports `birthtime = 0` (common on Docker volume mounts and older Linux filesystems), fall back to `mtimeMs` on the backend. The API contract is "`birthtimeMs` is the best available creation time".

**Why**: Linux ext4 without the `-O ^metadata_csum_seed` option and bind-mounts from the host often report `0` for birthtime. We prefer "slightly wrong Created date" over "missing field" in the UI.

**Risk**: For files that predate this change, `mtime` may be much later than actual creation (e.g., a restored backup). We accept this — there is no better signal without scanning git history, and this is a display nicety, not a correctness concern.

### 4. Bucket boundaries computed client-side, labels localized via `Intl.RelativeTimeFormat`

**Decision**: Frontend pure helper `utils/recent-buckets.ts` groups entries into:
- Today (mtime ≥ start-of-today in local tz)
- Yesterday (mtime ≥ start-of-yesterday)
- Earlier this week (mtime ≥ start of ISO week)
- Earlier this month (mtime ≥ start of calendar month)
- Older (everything else, capped at 500 entries to keep the DOM small)

Per-row label uses `Intl.RelativeTimeFormat` ("2 hours ago", "yesterday") for consistency with the doc-header meta row.

**Why**: Client-side bucketing is O(n) single pass, correct for user's timezone, and sidesteps any server-side date-math caching. `Intl.RelativeTimeFormat` is built-in (no dep) and matches the redesign's existing relative-time usage in `RecentSection`.

**DST and clock-skew edge cases**:
- Local-midnight boundaries computed via `new Date(y, m, d)` — the JS engine handles DST shifts. The minute around a spring-forward transition may briefly mis-bucket a file modified in the lost hour; acceptable.
- Future-dated `mtime` (clock skew, restored archive) → clamped to "Today" (not "In the future"). Helper returns `Math.min(mtimeMs, Date.now())` before bucketing.

### 5. `tweak.sidebarMode` persisted alongside existing tweak state

**Decision**: Extend the existing `tweak` shape with `sidebarMode: 'vault' | 'activity'`, default `'vault'`. Reuse the `localStorage['kalepin-tweaks']` payload and version migration path landing in redesign-editor-ui phase 2.5.

**Why**: Users expect the sidebar mode to stick across reloads. The tweak state already owns sidebar visibility/rail/minimap — mode belongs there.

### 6. Tree-row hover tooltip (not always-visible meta)

**Decision**: Add `title="updated 2h ago"` to `.file-tree-node` via a small effect hook computing the relative string on render. No DOM/layout change.

**Why**: Zero-cost discoverability. Users who want to know "when did I last touch this?" without switching modes have a native hover affordance. Keeps row visual density unchanged.

### 7. Doc-header `Created` is ADDED, not MODIFIED

**Decision**: In `specs/doc-header/spec.md` we add a new requirement covering the Created segment, rather than rewriting the existing Meta-row requirement from `redesign-editor-ui`.

**Why**: The base `doc-header` spec hasn't archived yet — it lives in `redesign-editor-ui`'s delta. Using ADDED keeps this change's spec delta valid regardless of whether `redesign-editor-ui` has archived when this change applies. The two requirements compose cleanly at archive time.

## Risks / Trade-offs

- **[Perf] `list()` gets slower on huge vaults** → Measured tens-of-ms worst case on 5k files; if it regresses noticeably, switch from per-entry `fs.stat` to `opendir` with `Dirent.stat()`, or cache mtime against the file-watcher's change events.

- **[Correctness] `birthtimeMs` is approximate on Linux/Docker** → Accepted. Falls back to `mtimeMs`. Documented in spec and visible in UI as `Created <date>` with no qualifier — users expect "Created" to be approximate on synced files anyway.

- **[Ordering] Frontend depends on redesign-editor-ui tokens + sidebar scaffold** → Backend work starts immediately and ships independently. Frontend lands after `redesign-editor-ui` archives (or in a feature branch that rebases onto it). Documented in proposal Impact.

- **[Confusion] Activity view vs existing Recent section** → Two concepts coexist: Recent = files I opened on this client (visit-based, localStorage), Activity = files that changed (mtime-based, server). Sidebar copy / section titles keep them distinct ("Recent" vs "Activity"). Revisit consolidation only if users report confusion.

- **[Scale] Flat list with 10k+ files** → Bucket pass is O(n); DOM render capped at 500 "Older" entries with a "Show more" trigger. Expected real-world vaults are far below this.

- **[DST] Bucket boundaries near 2am spring-forward** → Off-by-one hour for files modified in the missing local hour. Acceptable cosmetic defect twice a year.

## Migration Plan

1. Backend ships first: `FileEntry` gains optional `mtimeMs` / `birthtimeMs`. Existing frontend ignores them (no change). Safe to deploy solo.
2. Frontend lands `ActivityView` + sidebar toggle behind `tweak.sidebarMode`. Default `'vault'` keeps old behavior unless the user flips the toggle.
3. Doc-header `Created` segment wires in once `redesign-editor-ui`'s DocHeader.tsx exists.
4. Tree-row tooltip is a tiny follow-up landing anytime after backend.

**Rollback**: Frontend additions are gated behind the toggle default. Backend additions are additive — reverting is just removing the two fields from the response with no client impact.

## Open Questions

- Do we want a per-folder Activity scope ("what changed in `/projects/syren/` this week?") or always full-vault? Current scope: full-vault only. Revisit if requested.
- Should the doc-header Created segment be clickable (scroll to first commit / history view)? Current scope: plain text. Revisit with backlinks/history pill work.
- `Intl.RelativeTimeFormat` locale — use `navigator.language` or a tweak-level override? Default to `navigator.language`; revisit if i18n work formalizes a language tweak.
