## 1. Phase 1 — Backend: expose mtime / birthtime on file listing

- [ ] 1.1 Extend `FileEntry` in `packages/shared/src/models.ts` with `mtimeMs: number` and `birthtimeMs: number` (both required on every entry, files and directories).
- [ ] 1.2 Update `LocalFSAdapter.list()` in `packages/backend/src/storage/local-fs.adapter.ts` to populate `mtimeMs` and `birthtimeMs` from `fs.stat()` for every entry. Apply the fallback: if `stat.birthtimeMs === 0` or falsy, set `birthtimeMs = mtimeMs`.
- [ ] 1.3 Verify `GitAdapter` in `packages/backend/src/storage/git.adapter.ts` inherits the change with no override needed (it extends `LocalFSAdapter` and delegates `list()`).
- [ ] 1.4 Measure `listTree` latency on a fixture vault of ~5k files (use `time curl /files/tree > /dev/null`). If >100ms overhead vs baseline, parallelize per-directory or switch to `opendir` + `Dirent` where available.
- [ ] 1.5 Add unit test in `packages/backend/src/storage/local-fs.adapter.test.ts` (create if missing) asserting that `list()` returns numeric `mtimeMs` and `birthtimeMs` for files and directories, and that `birthtimeMs` falls back to `mtimeMs` when the stub reports `0`.
- [ ] 1.6 Update any existing backend tests that construct `FileEntry` fixtures — add the two required fields (or switch to a `makeFileEntry()` test helper).
- [ ] 1.7 Update the `file-management` section of `packages/backend/src/files/files.service.ts` if it maps/reshapes the listing (passes through by default — confirm no stripping).

## 2. Phase 2 — Frontend: wire the new fields through

- [ ] 2.1 Run `tsc -b` after phase 1 ships to surface every consumer of `FileEntry` that now needs to tolerate the new fields. Expect zero type errors (additive), but confirm.
- [ ] 2.2 Confirm `packages/frontend/src/api.ts` picks up the new `FileEntry` shape automatically (shared types). No runtime change expected.
- [ ] 2.3 Add a `utils/recent-buckets.ts` pure helper exporting: `bucketEntries(entries: FileEntry[], now: number): Bucket[]` where `Bucket = { id: 'today'|'yesterday'|'week'|'month'|'older', label: string, files: FileEntry[] }`. Implement clamping `mtimeMs = Math.min(mtimeMs, now)`. Sort each bucket `mtimeMs` desc. Cap `older` at 500.
- [ ] 2.4 Unit test `recent-buckets.ts` with table-driven cases: midnight boundary both sides, yesterday boundary, ISO-week boundary (Sunday → Monday in `en-US`, Sunday → Monday with ISO weeks), spring-forward DST 2:00 → 3:00, fall-back DST 2:00 → 1:00, future `mtimeMs` clamp, 600-entry `older` cap.

## 3. Phase 3 — Sidebar mode toggle (tweak state)

- [ ] 3.1 Extend the `tweak` state shape in `App.tsx` (or wherever the tweak context now lives after `redesign-editor-ui` phase 2) with `sidebarMode: 'vault' | 'activity'`, default `'vault'`.
- [ ] 3.2 Bump the `version` stored under `localStorage['kalepin-tweaks']` and migrate: any payload missing `sidebarMode` gets `'vault'`.
- [ ] 3.3 Add a `SidebarModeToggle` component (or inline in `VaultHeader.tsx`) rendering a two-option segmented control styled with the existing `--kalepin-primary-fade` + `--kalepin-primary` active treatment. Use `kp-tab-strip`-ish tokens to match the top-bar TabPill visual language.
- [ ] 3.4 Wire the toggle to read/write `tweak.sidebarMode` via the tweak setter.
- [ ] 3.5 In the sidebar body, render `FileTree` when `tweak.sidebarMode === 'vault'`, `ActivityView` when `'activity'`. Both siblings under the existing scroll container.

## 4. Phase 4 — ActivityView component

- [ ] 4.1 Create `packages/frontend/src/components/Sidebar/ActivityView.tsx`. Props: `{ files: FileEntry[], activePath: string | null, onOpen: (path: string) => void }`. Flatten the tree (files only, strip `_attachments` like `FileTree` does, strip dot-prefixed).
- [ ] 4.2 Use `bucketEntries` to group. Render bucket headers using the existing `SidebarSectionTitle` component for visual consistency.
- [ ] 4.3 Render each file row with `.kp-node` styling: file icon, display name (stripped of `.md`), right-aligned relative-time meta via `formatRelativeTime(mtimeMs)` reused from `utils/recent-files.ts`.
- [ ] 4.4 Click handler calls `onOpen(file.path)`. Active row (`file.path === activePath`) gets `.is-active` class.
- [ ] 4.5 Implement the `Show N more` control for the `older` bucket — `useState` for expanded flag, toggle on click.
- [ ] 4.6 Relative-time tick: `setInterval(() => forceRerender(), 60_000)` on mount, clear on unmount (mirror the pattern in `RecentSection`).
- [ ] 4.7 Empty-state card: when `files.length === 0` render a muted card reading `No recent activity`; when the files prop is `null`/undefined render `Loading…`.

## 5. Phase 5 — Doc-header Created segment

- [ ] 5.1 Extend the file-metadata payload consumed by the open document so the editor has access to `birthtimeMs`. Check `packages/frontend/src/App.tsx` and the API call that opens a doc — if the current read endpoint doesn't return it, use the file-tree entry already in memory.
- [ ] 5.2 In `packages/frontend/src/editor/DocHeader.tsx` (created by `redesign-editor-ui` phase 6), add a `Created <locale-date>` segment before the `edited N minutes ago` segment in the meta row.
- [ ] 5.3 Format via `new Intl.DateTimeFormat(navigator.language, { dateStyle: 'medium' }).format(new Date(birthtimeMs))`.
- [ ] 5.4 No qualifier when `birthtimeMs === mtimeMs` (fallback case) — spec explicitly says render plain.

## 6. Phase 6 — Vault-tree hover tooltip

- [ ] 6.1 In `packages/frontend/src/components/FileTree.tsx` add a `title` attribute to the file-row div: `updated ${formatRelativeTime(entry.mtimeMs)}`.
- [ ] 6.2 Skip for directories — guard on `entry.type === 'file'`.
- [ ] 6.3 No CSS change required. Confirm the title attribute doesn't conflict with existing drag events (native tooltips don't interfere with drag).

## 7. Phase 7 — Validation and QA

- [ ] 7.1 Run `openspec validate tree-activity-view --strict` — all spec deltas parse and resolve.
- [ ] 7.2 Manual QA: toggle between Vault and Activity, confirm mode persists across reload, confirm a collaborator edit bumps Activity ordering within 30s (relies on file-watcher refetch — if refetch isn't wired for Activity, add a `getFileTree()` poll on visibility change).
- [ ] 7.3 Manual QA on a vault with `>1000` files — bucket grouping renders under 50ms (use the React DevTools profiler).
- [ ] 7.4 Manual QA on a Docker-mounted vault where `birthtime` is likely `0` — confirm Activity view and doc-header Created still render sensibly (falling back to `mtimeMs`).
- [ ] 7.5 Regression: confirm `FileTree`, `StarredSection`, `RecentSection`, search modal unaffected.
- [ ] 7.6 Update tour/coach-mark selectors if Phase 3 renaming in `VaultHeader.tsx` touched any `.kp-*` classes referenced by the tour engine.
