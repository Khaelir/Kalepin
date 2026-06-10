## 1. User Attribution (Backend)

- [x] 1.1 Add nullable `userId` integer column to `NoteChange` entity with index
- [x] 1.2 Update `ChangeTrackingService.trackChange()` to accept optional `userId` parameter and persist it
- [x] 1.3 OT flush path: resolve last-active userId from the session's connected clients, pass to `trackChange()`
- [x] 1.4 Non-OT write paths (files service): pass authenticated userId from request context to `trackChange()`
- [x] 1.5 Update `getChangesSince()` to accept `excludeUserId` param and filter out own changes
- [x] 1.6 Add `user` field (email) to `FileChangeSummary` response by joining with `users` table

## 2. Stars (Backend)

- [x] 2.1 Create `StarredItem` entity (`starred_items` table): id, userId, type, path, createdAt with unique constraint on (userId, type, path)
- [x] 2.2 Create `StarsController` with `GET /api/stars`, `POST /api/stars`, `DELETE /api/stars/:id` — enforce 5-item cap on POST (return 409)
- [x] 2.3 Create `StarsService` to encapsulate star CRUD and path update logic
- [x] 2.4 Update `getChangesSince()` to accept starred items and split response into `starred` and `other` groups
- [x] 2.5 Register new entity and module

## 3. Mark as Seen (Backend)

- [x] 3.1 Add `POST /api/updates/mark-seen` endpoint that updates `user.lastActiveAt = now()` without returning changes
- [x] 3.2 Modify `GET /api/updates` to NOT auto-update `lastActiveAt` (decouple fetch from mark-seen)

## 4. Rename Tracking (Backend)

- [x] 4.1 Add rename correlation utility: debounce unlink+add events (300ms window), match by content
- [x] 4.2 Hook into chokidar watcher in `LocalFSAdapter`: on correlated rename, emit rename event with oldPath/newPath
- [x] 4.3 On rename event: update `starred_items.path` and `note_changes.path` for matching rows
- [x] 4.4 Handle folder renames: update all rows where path starts with old prefix

## 5. API Client (Frontend)

- [x] 5.1 Add `getUpdates(since?: string)` method to API client
- [x] 5.2 Add `markUpdatesSeen()` method
- [x] 5.3 Add `getStars()`, `addStar(type, path)`, `removeStar(id)` methods

## 6. Changes Panel UI (Frontend)

- [x] 6.1 Create `ChangesPanel` component: dropdown panel with starred/other sections, expandable diffs, file navigation
- [x] 6.2 Create `ChangesBadge` toolbar icon component: badge with count, escalation style for starred changes, hover tooltip with summary
- [x] 6.3 Wire up data fetching: load updates + stars on app mount, store in state
- [x] 6.4 Implement diff rendering: syntax-highlighted additions/deletions, collapsible per-file
- [x] 6.5 Implement click-to-navigate: clicking a file entry opens it in the editor
- [x] 6.6 Implement "Mark all as seen" button: calls mark-seen endpoint, clears badge

## 7. Star Toggle in File Tree (Frontend)

- [x] 7.1 Add ☆/★ toggle icon on file/folder hover in the file tree component
- [x] 7.2 Starred items show persistent ★ (not only on hover)
- [x] 7.3 Enforce 5-item cap in UI with tooltip feedback
- [x] 7.4 Optimistic state update on toggle, rollback on API error

## 8. Toast Notifications (Frontend)

- [x] 8.1 On app load, check for starred file changes and fire toasts (max 3, aggregate if more)
- [x] 8.2 Toast format: "★ filename was [action] by [user] · [relative time]"
- [x] 8.3 Auto-dismiss after 5s, manually dismissible
