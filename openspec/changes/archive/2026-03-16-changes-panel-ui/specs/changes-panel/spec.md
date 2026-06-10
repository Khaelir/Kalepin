## changes-panel

Frontend toolbar icon with badge and dropdown panel showing changes since last visit.

### Requirements

#### Toolbar Icon
- Icon in the main toolbar (right side, near settings)
- Shows a numeric badge when changes exist, hidden when no changes
- Badge shows count of changed files (not individual change records)
- Badge escalation: default style for normal changes, accent color + star indicator when starred files have changes
- Hover tooltip: "What's changed — N changes across M files since [relative date]"
- Icon hidden or disabled when no changes have ever been recorded (first-time user)

#### Dropdown Panel
- Opens on icon click, anchored below the toolbar icon
- Max height with scroll for long change lists
- Header: "Since [date] ([relative time])" + summary stats "N files · X created · Y modified · Z deleted"
- Two sections when starred changes exist:
  - "★ Starred" section at top — starred file changes with first diff expanded
  - "Other changes" section — remaining changes with diffs collapsed
- Single section when no starred changes (no empty starred section)
- Each file entry shows:
  - Action icon: ✎ modified, + created, × deleted
  - File name (clickable — navigates to file in editor)
  - Author email/name + relative timestamp
  - Expandable diff with syntax-highlighted additions (green) / deletions (red)
  - For new files: "(new file — N lines)" instead of diff
  - For deleted files: "(deleted)" with no expandable diff
- "Mark all as seen" button at the bottom — updates `lastActiveAt` and clears badge
- Clicking outside the panel closes it (without marking as seen)

#### Toast Notifications
- On page load, if starred files have changes: show toast per file, max 3
- If more than 3 starred files changed: aggregate into "★ N starred files changed"
- Toast format: "★ filename was [action] by [user] · [relative time]"
- Toasts auto-dismiss after 5 seconds, manually dismissible

#### File Tree Star Toggle
- On hover over file/folder in file tree: show ☆ icon
- Click ☆ to star (fills to ★), click ★ to unstar
- Starred items show persistent ★ (not only on hover)
- At 5-item cap: ☆ still visible but click shows tooltip "Maximum 5 starred items"
- Stars persisted via `POST/DELETE /api/stars`

#### Data Flow
- On app load: fetch `GET /api/updates` (without updating lastActiveAt)
- Store response in state, compute badge count and starred/other split
- "Mark all as seen" calls `POST /api/updates/mark-seen` (new endpoint) to update lastActiveAt without re-fetching changes
- Stars: fetch `GET /api/stars` on load, update optimistically on toggle

### New Endpoint

`POST /api/updates/mark-seen` — updates `user.lastActiveAt = now()` without returning changes. Separated from `GET /api/updates` so fetching changes doesn't auto-clear the badge.

### API Client Methods

```typescript
getUpdates(since?: string): Promise<UpdatesResponse>
markUpdatesSeen(): Promise<void>
getStars(): Promise<StarredItem[]>
addStar(type: 'file' | 'folder', path: string): Promise<StarredItem>
removeStar(id: number): Promise<void>
```
