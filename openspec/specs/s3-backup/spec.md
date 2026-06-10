# s3-backup Specification

## Purpose
TBD - created by archiving change s3-vault-backup. Update Purpose after archive.
## Requirements
### Requirement: Compressed vault archive creation
The system SHALL create a `.tar.gz` archive containing the entire vault directory (markdown notes, `.collab` sidecar files, `_attachments/` images) and a consistent SQLite database backup. The archive SHALL be written to a temporary file and cleaned up after upload.

#### Scenario: Archive includes all vault content
- **WHEN** a backup is triggered
- **THEN** the resulting `.tar.gz` archive MUST contain all files under `VAULT_PATH` (including subdirectories, hidden `.collab` sidecars, and the `_attachments/` directory) and a SQLite backup file named `kalepin.sqlite`

#### Scenario: Database backup is consistent
- **WHEN** a backup is triggered while the database is in use
- **THEN** the system SHALL use the SQLite online backup API to produce a consistent database snapshot without blocking reads or writes

#### Scenario: Temp file cleanup
- **WHEN** a backup completes (success or failure)
- **THEN** the temporary archive file SHALL be deleted from disk

### Requirement: S3 upload
The system SHALL upload the compressed archive to a configured S3 bucket using multipart streaming upload. The S3 object key SHALL follow the pattern `{S3_BACKUP_PREFIX}/kalepin-backup-{ISO-timestamp}.tar.gz`.

#### Scenario: Successful upload
- **WHEN** the archive is created and S3 credentials are valid
- **THEN** the system SHALL upload the archive to the configured S3 bucket and log the object key and size

#### Scenario: Upload failure
- **WHEN** the S3 upload fails (network error, auth error, bucket not found)
- **THEN** the system SHALL log the error with details and the temp file SHALL still be cleaned up

#### Scenario: S3-compatible endpoint
- **WHEN** `S3_BACKUP_ENDPOINT` environment variable is set
- **THEN** the S3 client SHALL use that endpoint URL, enabling MinIO or other S3-compatible providers

### Requirement: Scheduled backups
The system SHALL run backups on a configurable schedule defined by a cron expression in the `S3_BACKUP_SCHEDULE` environment variable. The default schedule SHALL be daily at 03:00 UTC (`0 3 * * *`).

#### Scenario: Default schedule
- **WHEN** `S3_BACKUP_SCHEDULE` is not set and backup is enabled
- **THEN** the system SHALL run backups daily at 03:00 UTC

#### Scenario: Custom schedule
- **WHEN** `S3_BACKUP_SCHEDULE` is set to a valid cron expression (e.g., `0 */6 * * *`)
- **THEN** the system SHALL run backups at the specified interval

#### Scenario: Concurrent backup prevention
- **WHEN** a scheduled backup triggers while another backup is already in progress
- **THEN** the system SHALL skip the new run and log a warning

### Requirement: Backup retention policy
The system SHALL automatically delete backups older than a configurable retention period from S3. The retention period is defined by `S3_BACKUP_RETENTION_DAYS` (default: 30).

#### Scenario: Pruning old backups
- **WHEN** a backup completes successfully
- **THEN** the system SHALL list existing backups in the S3 prefix and delete any whose timestamp is older than `S3_BACKUP_RETENTION_DAYS` days

#### Scenario: Retention disabled
- **WHEN** `S3_BACKUP_RETENTION_DAYS` is set to `0`
- **THEN** the system SHALL not delete any backups (unlimited retention)

### Requirement: Manual backup trigger via API
The system SHALL expose a `POST /api/admin/backup` endpoint that triggers an immediate backup and returns the result.

#### Scenario: Trigger manual backup
- **WHEN** an authenticated admin sends `POST /api/admin/backup`
- **THEN** the system SHALL run a backup immediately and return `{ key, size, duration }` on success

#### Scenario: Backup already in progress
- **WHEN** `POST /api/admin/backup` is called while a backup is already running
- **THEN** the system SHALL return HTTP 409 with `{ error: "Backup already in progress" }`

### Requirement: List existing backups via API
The system SHALL expose a `GET /api/admin/backup` endpoint that returns a list of existing backups in S3.

#### Scenario: List backups
- **WHEN** an authenticated admin sends `GET /api/admin/backup`
- **THEN** the system SHALL return an array of `{ key, size, lastModified }` for each backup in the S3 prefix, sorted by most recent first

### Requirement: Environment variable validation
The system SHALL validate S3-related environment variables at startup when backup is enabled.

#### Scenario: Backup disabled (opt-in)
- **WHEN** `S3_BACKUP_BUCKET` is not set
- **THEN** the backup module SHALL not register any scheduled jobs or API endpoints, and the system SHALL start normally

#### Scenario: Missing required variables
- **WHEN** `S3_BACKUP_BUCKET` is set but `S3_BACKUP_REGION`, `S3_BACKUP_ACCESS_KEY_ID`, or `S3_BACKUP_SECRET_ACCESS_KEY` is missing
- **THEN** the system SHALL fail to start and log an error listing the missing variables

#### Scenario: Valid configuration
- **WHEN** all required S3 variables are set
- **THEN** the system SHALL log "S3 backup enabled" with the bucket name and schedule at startup

