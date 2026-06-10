## Why

There is no disaster recovery mechanism for vault data. If the server disk fails or data is accidentally deleted, all notes, images, comments, and version history are lost. Compressed backups to S3 provide off-site recovery with minimal cost and operational overhead.

## What Changes

- Add a new `BackupModule` with a `BackupService` that creates compressed `.tar.gz` archives of the full vault (markdown notes, sidecars, attachments) and the SQLite database
- Add scheduled backups via `@nestjs/schedule` with a configurable cron expression
- Upload compressed archives to a configurable S3 bucket with optional path prefix
- Add retention policy to automatically prune old backups from S3
- Add an admin API endpoint to trigger a manual backup and list existing backups
- Add S3 and backup-related environment variables with startup validation
- Add `@aws-sdk/client-s3` and `@nestjs/schedule` dependencies

## Capabilities

### New Capabilities
- `s3-backup`: Scheduled and on-demand compressed vault backup to S3, including archive creation, upload, retention-based pruning, and admin API endpoints

### Modified Capabilities

_None_ — this is a standalone feature with no changes to existing capability requirements.

## Impact

- **Dependencies**: `@aws-sdk/client-s3`, `@nestjs/schedule` added to backend
- **Docker**: New env vars documented; no image change needed (S3 SDK is pure JS)
- **Environment**: New required vars when backup is enabled: `S3_BACKUP_BUCKET`, `S3_BACKUP_REGION`, `S3_BACKUP_ACCESS_KEY_ID`, `S3_BACKUP_SECRET_ACCESS_KEY`. Optional: `S3_BACKUP_PREFIX`, `S3_BACKUP_SCHEDULE`, `S3_BACKUP_RETENTION_DAYS`
- **Disk**: Temporary disk usage during archive creation (size of vault + DB)
- **APIs**: New `/api/admin/backup` endpoints (trigger, list)
- **Existing code**: No modifications to existing modules or services
