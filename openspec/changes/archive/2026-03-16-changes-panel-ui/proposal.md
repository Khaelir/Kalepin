## Why

The "what's changed since last visit" feature is MCP-only — it requires an LLM to make sense of raw diffs. Users coming back to the app have no way to see what collaborators changed. This adds a visual changelog panel in the main app, with a star system for priority tracking on files that matter most.

Builds on top of the completed `add-whats-new` change which established the `note_changes` table, `ChangeTrackingService`, and `GET /api/updates` endpoint.

## What Changes

- **Toolbar icon with badge**: unobtrusive indicator showing number of changes since last visit, with hover tooltip summarizing the changes
- **Changes dropdown panel**: click the icon to see changes grouped by folder, with expandable inline diffs and click-to-navigate
- **User attribution on changes**: add `userId` to `note_changes` so changes show who made them, and filter out your own changes
- **Star system**: star up to 5 files or folders for priority notifications — starred changes appear at the top of the panel, badge escalates visually, and a toast fires on page load
- **Rename tracking**: update `starred_items` and `note_changes` paths when files are renamed on disk, keeping stars and history intact without needing file UUIDs

## Capabilities

### New Capabilities
- `changes-panel`: Frontend toolbar icon + dropdown panel showing changes since last visit
- `star-files`: Star files/folders for priority change notifications (max 5)
- `rename-tracking`: Update star and change paths when files are renamed on disk

### Modified Capabilities
- `user-attribution`: Add userId to `note_changes` and filter own changes from the updates response

## Impact

- **Backend**: Modified `NoteChange` entity (+userId), new `StarredItem` entity, modified `ChangeTrackingService` (accept userId, split starred/other in response), new stars REST endpoints, rename event handling in storage adapter
- **Frontend**: New `ChangesPanel` component, new toolbar icon with badge, star toggle in file tree, toast system for starred changes, new API client methods
- **Database**: One new table (`starred_items`), one column addition (`note_changes.userId`)
