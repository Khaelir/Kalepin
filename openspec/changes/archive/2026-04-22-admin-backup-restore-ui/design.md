## Context

Backup/restore is currently S3-only: `BackupModule` is conditionally loaded (`S3_BACKUP_BUCKET` must be set), and restore only exists as an MCP tool. The `createArchive()` method already produces a light `.tar.gz` (vault + stripped DB), and `restoreFromS3()` already handles atomic swap logic — but both are wired to S3.

The frontend Settings page has an admin detection mechanism (`userIsAdmin` from `/api/auth/api-keys/whoami`) but no backup UI. Multer is already a dependency used by `AttachmentsController`.

## Goals / Non-Goals

**Goals:**
- Admin can download a backup archive from the browser (no S3 required)
- Admin can upload a `.tar.gz` to restore vault + DB (no S3 required)
- Frontend gracefully handles the post-restore server restart
- Archive download/upload works regardless of whether S3 is configured

**Non-Goals:**
- S3 backup listing in the UI
- S3-based restore from the UI
- Safety-net backup before restore
- Upload size limits
- Selective file restore

## Decisions

### 1. Split BackupService: always-loaded core vs S3-optional

**Decision**: Extract archive creation and local restore into a new `ArchiveService` that is always loaded. `BackupService` remains S3-specific and conditionally loaded.

**Why**: `BackupModule` is gated on `S3_BACKUP_BUCKET`. Rather than restructuring it (which would risk breaking S3 cron and MCP tools), a separate `ArchiveService` with its own module/controller provides clean separation. `ArchiveService` reuses the same archive creation logic (`createArchive`) and atomic swap logic, but has no S3 dependency.

**Alternatives considered**:
- *Always load BackupModule, skip S3 init*: Would require refactoring `onModuleInit` to be conditional throughout — fragile, mixes concerns.
- *Add endpoints to BackupController behind separate guards*: Couples local archive flow to S3 module lifecycle.

### 2. Stream archive directly via Response object

**Decision**: The download endpoint calls `createArchive()`, then streams the `.tar.gz` file via `res.download()` / `res.sendFile()`, and cleans up the temp dir afterward.

**Why**: `createArchive()` already writes to a temp file. Streaming from that file is simple and avoids buffering the entire archive in memory. Cleanup happens in a `finally` block or `res.on('finish')` callback.

### 3. Multer with no size limit for upload

**Decision**: Use `FileInterceptor('file')` with no `limits` option (defaults to no limit). The uploaded file is written to a temp location by multer, then validated and used for restore.

**Why**: User explicitly wants no size limit. Multer is already in the project. The same `FileInterceptor` pattern is used by `AttachmentsController`.

### 4. Archive validation before swap

**Decision**: After extracting the uploaded archive to a staging directory, verify it contains both `vault/` (directory) and `kalepin.sqlite` (file) before proceeding with the atomic swap. Return 400 with a clear message if validation fails.

**Why**: Prevents accidental data loss from uploading a wrong file.

### 5. Respond 200 then exit

**Decision**: The restore endpoint sends a 200 response with `{ message: 'Restore complete, restarting...' }`, then calls `setTimeout(() => process.exit(0), 500)`. This matches the existing MCP restore pattern.

**Why**: The client needs to receive the success response before the server dies. The 500ms delay gives the response time to flush. The container orchestrator (Docker) handles restart.

### 6. Frontend polls /api/health after restore

**Decision**: After receiving the 200 from restore, the frontend shows a "Restoring..." overlay and polls `GET /api/health` every 2 seconds. On success, it calls `window.location.reload()`.

**Why**: `GET /api/health` exists, is unauthenticated, and returns `{ status: 'ok' }`. Polling is simple and reliable. The overlay prevents user interaction during the restart window.

### 7. Double confirmation for restore

**Decision**: Click "Restore" → inline confirmation message ("This will replace all notes and data. Are you sure?") with "Confirm Restore" / "Cancel" buttons. Not a modal dialog.

**Why**: Inline confirmation is consistent with the existing revoke-key pattern in SettingsPage. Less intrusive than a modal, but still prevents accidental clicks.

## Risks / Trade-offs

**Large archives may take time to create/download** → The download button shows a loading spinner. No timeout on the backend. Acceptable for a rare admin operation.

**Server restart drops all active WebSocket connections** → Existing behavior for MCP restore. Editors will reconnect automatically via the OT reconnection logic. Not a new risk.

**No safety-net backup** → User's explicit choice. The download feature itself serves as a manual safety net — admin can download before restoring.

**Multer stores upload in memory by default** → For large archives, this could use significant memory. Could use `dest` option to write to disk instead. Worth using disk storage for safety, since we have no size limit.
