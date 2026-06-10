## 1. Data Layer — Snapshots & Retention

- [x] 1.1 Create `NoteSnapshot` entity (`note_snapshots` table) with columns: `id`, `path`, `changeId`, `content` (text), `createdAt`
- [x] 1.2 Add `VERSION_HISTORY_RETENTION_DAYS` env var (default 365) to app configuration
- [x] 1.3 Modify `ChangeTrackingService.trackChange()` to store a snapshot on `created` actions (initial content) and every N changes (configurable interval, default 20)
- [x] 1.4 Split pruning logic: feed pruning (90 days / last-active) no longer deletes `note_changes` rows; add separate `pruneVersionHistory()` method that prunes changes + snapshots older than retention period

## 2. Version Reconstruction Service

- [x] 2.1 Create `VersionHistoryService` with `getHistory(path)` — returns ordered list of changes for a path with user email resolution
- [x] 2.2 Implement `reconstructVersion(path, changeId)` — finds nearest snapshot before `changeId`, replays diffs forward, returns full content (or partial content + warning on failure)
- [x] 2.3 Implement `restoreVersion(path, changeId, userId)` — reconstructs historical content and submits it as an OT operation via the OT service
- [x] 2.4 Register `VersionHistoryService` in the changes module with required dependencies (`NoteSnapshot` repo, `NoteChange` repo, OT service)

## 3. API Endpoints

- [x] 3.1 Add `GET /api/files/history?path=...` endpoint — returns change list with user attribution and timestamps
- [x] 3.2 Add `GET /api/files/version?path=...&changeId=...` endpoint — returns reconstructed content at that change
- [x] 3.3 Add `POST /api/files/restore` endpoint (body: `{ path, changeId }`) — triggers restore through OT, returns success/failure
- [x] 3.4 Add auth guards and input validation to all new endpoints

## 4. Frontend — Version History Panel

- [x] 4.1 Create `VersionHistoryPanel` component with timeline list (user, relative time, action type), loading/empty states
- [x] 4.2 Add version history toolbar button (clock icon) to the editor toolbar, wired to toggle the panel
- [x] 4.3 Implement sidebar panel management — version history replaces comments panel when opened (one panel at a time)
- [x] 4.4 Add API client functions: `fetchHistory(path)`, `fetchVersion(path, changeId)`, `restoreVersion(path, changeId)`

## 5. Frontend — Version Preview & Diff

- [x] 5.1 Implement read-only version preview: clicking a history entry loads reconstructed content into a read-only TipTap instance with a "viewing historical version" banner
- [x] 5.2 Implement "Back to current" action to return to live editing mode
- [x] 5.3 Implement unified diff view in the panel showing additions (green) and deletions (red) between selected version and current content
- [x] 5.4 Add "Restore this version" button with confirmation dialog, wired to the restore API endpoint
