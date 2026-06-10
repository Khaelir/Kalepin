## 1. Dependencies & Module Scaffold

- [x] 1.1 Add `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@nestjs/schedule`, and `tar` to backend `package.json` and install
- [x] 1.2 Create `packages/backend/src/backup/` module directory with `backup.module.ts`, `backup.service.ts`, and `backup.controller.ts`
- [x] 1.3 Register `ScheduleModule.forRoot()` in `app.module.ts`
- [x] 1.4 Conditionally import `BackupModule` in `app.module.ts` (only when `S3_BACKUP_BUCKET` is set)

## 2. Environment Validation

- [x] 2.1 Add S3 env var validation in `BackupModule.onModuleInit()`: require `S3_BACKUP_BUCKET`, `S3_BACKUP_REGION`, `S3_BACKUP_ACCESS_KEY_ID`, `S3_BACKUP_SECRET_ACCESS_KEY`; fail startup with clear error if any missing
- [x] 2.2 Read optional vars: `S3_BACKUP_PREFIX` (default: `backups`), `S3_BACKUP_SCHEDULE` (default: `0 3 * * *`), `S3_BACKUP_RETENTION_DAYS` (default: `30`), `S3_BACKUP_ENDPOINT` (optional)
- [x] 2.3 Log "S3 backup enabled" with bucket name and schedule on successful init
- [x] 2.4 Add all S3 backup env vars to `.env.example` with comments

## 3. Archive Creation

- [x] 3.1 Implement `createArchive()` in `BackupService`: create a `.tar.gz` temp file containing all files under `VAULT_PATH`
- [x] 3.2 Add SQLite backup step: use `better-sqlite3` `.backup()` API to dump the database to a temp file, then include it in the archive as `kalepin.sqlite`
- [x] 3.3 Ensure temp files (archive + DB backup) are cleaned up in a `finally` block

## 4. S3 Upload & Retention

- [x] 4.1 Implement `uploadToS3()`: initialize S3 client with configured credentials/endpoint, use `Upload` from `@aws-sdk/lib-storage` for multipart streaming upload with key format `{prefix}/kalepin-backup-{ISO-timestamp}.tar.gz`
- [x] 4.2 Implement `pruneOldBackups()`: list objects in the S3 prefix, parse timestamps from keys, delete objects older than retention period. Skip pruning when retention days is `0`
- [x] 4.3 Log upload success (key, size, duration) and pruning results (count deleted)

## 5. Scheduled Execution

- [x] 5.1 Implement `runBackup()` orchestrator: acquire in-memory mutex lock, call `createArchive()` → `uploadToS3()` → `pruneOldBackups()`, release lock in `finally`
- [x] 5.2 Register `@Cron()` decorator on the scheduled entry point using `S3_BACKUP_SCHEDULE` value — use `CronExpression` or dynamic scheduling via `SchedulerRegistry`
- [x] 5.3 Skip execution with a warning log when mutex is already held (concurrent prevention)

## 6. Admin API

- [x] 6.1 Implement `POST /api/admin/backup` in `BackupController`: trigger `runBackup()`, return `{ key, size, duration }` on success, return HTTP 409 if backup already in progress
- [x] 6.2 Implement `GET /api/admin/backup` in `BackupController`: list S3 objects in prefix, return `[{ key, size, lastModified }]` sorted most recent first
- [x] 6.3 Guard both endpoints with existing auth (JWT guard)

## 7. Docker & Documentation

- [x] 7.1 Add S3 backup env vars to `docker-compose.yml` as commented-out examples
- [x] 7.2 Verify the Docker image builds successfully with new dependencies (no native bindings — SDK is pure JS)

## 8. Testing

- [x] 8.1 Test archive creation produces a valid `.tar.gz` with expected file structure
- [x] 8.2 Test env validation rejects startup when required vars are partially set
- [x] 8.3 Test mutex prevents concurrent backup runs
- [x] 8.4 Test retention pruning logic correctly identifies and filters old backups
