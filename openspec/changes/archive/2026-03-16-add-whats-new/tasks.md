## 1. Schema & Entities

- [x] 1.1 Create `NoteChange` TypeORM entity (`note_changes` table) with fields: id, path, action, diff, created_at — plus indexes on created_at and path
- [x] 1.2 Add `lastActiveAt` nullable DATETIME column to `User` entity
- [x] 1.3 Run / verify TypeORM auto-synchronization picks up both changes (or create migration if needed)

## 2. Diff Library

- [x] 2.1 Install `diff` npm package in the backend
- [x] 2.2 Create a thin utility function `computeUnifiedDiff(oldContent: string, newContent: string, filePath: string): string` wrapping `createTwoFilesPatch`

## 3. ChangeTrackingService

- [x] 3.1 Create `ChangeTrackingService` (NestJS injectable) with methods: `trackChange(path, action, oldContent?, newContent?)`, `getChangesSince(since: Date)`, `pruneOldChanges()`
- [x] 3.2 `trackChange` computes the unified diff (for creates: full content, for deletes: null, for modifications: diff of old vs new) and inserts into `note_changes`
- [x] 3.3 `getChangesSince` queries `note_changes WHERE created_at > since`, groups by top-level folder, returns structured response with stats
- [x] 3.4 `pruneOldChanges` deletes rows older than `MIN(users.last_active_at)` capped at 90 days
- [x] 3.5 Register the service in the appropriate NestJS module

## 4. OT Flush Integration

- [x] 4.1 Add `lastFlushedContent: string` to `DocumentSession` interface, initialize from `initialContent` in `getOrCreateSession`
- [x] 4.2 In `flushToDisk`, after writing: compute diff between `lastFlushedContent` and `session.content`, call `ChangeTrackingService.trackChange()` asynchronously (fire-and-forget with error logging), then update `lastFlushedContent = session.content`

## 5. Non-OT Write Path Integration

- [x] 5.1 In the files service (or equivalent) `create` handler: call `trackChange(path, 'created', null, newContent)` after writing
- [x] 5.2 In the files service `update`/`edit` handler: read current content before writing, call `trackChange(path, 'modified', oldContent, newContent)` after writing
- [x] 5.3 In the files service `delete` handler: call `trackChange(path, 'deleted')` after deleting

## 6. get_updates REST Endpoint

- [x] 6.1 Create `GET /api/updates` endpoint (or add to existing controller), authenticated via CombinedAuthGuard
- [x] 6.2 Endpoint reads `user.lastActiveAt`, queries `ChangeTrackingService.getChangesSince()`, returns structured JSON response with period, stats, and by_folder grouping
- [x] 6.3 Accept optional `since` query parameter (ISO 8601) to override `lastActiveAt`
- [x] 6.4 After computing the response, update `user.lastActiveAt = new Date()` and save

## 7. MCP Tool: HTTP Service

- [x] 7.1 Add `get_updates` tool to the HTTP MCP service (`mcp.service.ts`) — calls the REST endpoint or service directly
- [x] 7.2 Tool description: "Get a summary of note changes since your last check, grouped by folder with diffs"

## 8. MCP Tool: Stdio Server

- [x] 8.1 Add `getUpdates(since?: string)` method to `KalepinClient` in the stdio MCP server, calling `GET /api/updates`
- [x] 8.2 Register `get_updates` tool in the stdio MCP server `index.ts` with input schema (optional `since` param)

## 9. Pruning

- [x] 9.1 Call `ChangeTrackingService.pruneOldChanges()` on application startup (e.g., in `onModuleInit`)
- [x] 9.2 Optionally schedule a daily prune via `@nestjs/schedule` or a simple `setInterval`
