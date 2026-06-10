## Why

Users want to ask their LLM assistant "what's new?" and get a meaningful summary of recent note changes. Currently there's no way to know what changed — the LLM can only read current content. For large files, knowing *which section* was modified matters more than knowing the file was touched.

## What Changes

- New `note_changes` SQLite table that persists unified diffs on every save event
- New `last_active_at` column on the `users` table, bumped when the user checks for updates
- New `ChangeTrackingService` that captures diffs at two points: OT flush (in-memory, zero extra I/O) and non-OT writes (one extra read)
- New `get_updates` MCP tool that returns categorized diffs since the user's last activity
- New `get_updates` REST endpoint backing the MCP tool
- Automatic pruning of old change records once all users have seen them

## Capabilities

### New Capabilities
- `change-tracking`: Persist diffs of note changes to SQLite on every save event, with pruning
- `user-last-activity`: Track when each user last checked for updates via a `last_active_at` field
- `get-updates-mcp`: MCP tool that returns diffs grouped by folder since the user's last activity

### Modified Capabilities

## Impact

- **Entities**: New `NoteChange` entity, modified `User` entity (+`lastActiveAt`)
- **OT session manager**: Add `lastFlushedContent` to `DocumentSession`, hook into `flushToDisk`
- **Storage writes**: Non-OT write paths (files service, MCP edit/create/delete) need to capture diffs
- **MCP server**: New `get_updates` tool in both HTTP and stdio MCP servers
- **Dependencies**: Need a diff library (e.g., `diff` or `fast-diff` npm package)
- **Database**: One new table + one column addition (both via TypeORM migration)
