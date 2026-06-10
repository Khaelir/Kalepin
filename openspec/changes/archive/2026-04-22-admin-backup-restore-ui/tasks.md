## 1. ArchiveService — always-loaded core

- [x] 1.1 Create `ArchiveService` with `createArchive()` (extract from `BackupService`) and `restoreFromArchive(filePath: string)` (extract atomic swap logic from `restoreFromS3`)
- [x] 1.2 Create `ArchiveModule` (imports `AuthModule`, `ScheduleModule`) and `ArchiveController` with the two new endpoints
- [x] 1.3 Register `ArchiveModule` unconditionally in `AppModule` (not gated on `S3_BACKUP_BUCKET`)
- [x] 1.4 Refactor `BackupService` to delegate to `ArchiveService.createArchive()` instead of duplicating logic

## 2. Download endpoint

- [x] 2.1 Implement `GET /api/admin/backup/download` — calls `createArchive()`, streams `.tar.gz` with `Content-Disposition: attachment`, cleans up temp dir on finish/error
- [x] 2.2 Guard with `CombinedAuthGuard` + `@RequiredScope('admin:backup')`

## 3. Restore endpoint

- [x] 3.1 Implement `POST /api/admin/backup/restore` — accepts multipart upload via `FileInterceptor` with disk storage (no size limit)
- [x] 3.2 Validate extracted archive contains `vault/` directory and `kalepin.sqlite` at root; return 400 if invalid
- [x] 3.3 Call `ArchiveService.restoreFromArchive()` for atomic swap, respond 200, then `setTimeout(() => process.exit(0), 500)`
- [x] 3.4 Guard with `CombinedAuthGuard` + `@RequiredScope('admin:backup')`

## 4. Frontend API functions

- [x] 4.1 Add `downloadBackup()` function in `api.ts` — `GET /api/admin/backup/download`, trigger browser file download from blob response
- [x] 4.2 Add `restoreBackup(file: File)` function in `api.ts` — `POST /api/admin/backup/restore` with `FormData` multipart body

## 5. Frontend Settings UI

- [x] 5.1 Add "Backup & Restore" section in `SettingsPage.tsx`, visible only when `userIsAdmin` is true
- [x] 5.2 Implement download button with loading state
- [x] 5.3 Implement file picker (`.tar.gz` accept) + Restore button with double confirmation (inline, matching revoke-key pattern)
- [x] 5.4 Implement post-restore "Restoring..." overlay that polls `GET /api/health` every 2s and auto-reloads on success
- [x] 5.5 Add CSS styles for the backup section, file picker, restore confirmation, and overlay

## 6. Tests

- [x] 6.1 Unit tests for `ArchiveService` — archive creation produces valid `.tar.gz` with stripped DB, `restoreFromArchive` performs atomic swap
- [x] 6.2 Integration/e2e sanity check — download endpoint returns gzip content-type, restore endpoint rejects invalid archive with 400
