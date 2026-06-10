# admin-backup-upload-restore Specification

## Purpose
TBD - created by archiving change admin-backup-restore-ui. Update Purpose after archive.
## Requirements
### Requirement: Upload and restore backup archive endpoint
The system SHALL expose `POST /api/admin/backup/restore` that accepts a `.tar.gz` archive upload, validates it, atomically replaces the vault and database, and restarts the application.

#### Scenario: Successful restore
- **WHEN** an authenticated admin uploads a valid `.tar.gz` file (containing `vault/` directory and `kalepin.sqlite`) to `POST /api/admin/backup/restore`
- **THEN** the server extracts the archive to a staging directory, atomically swaps the vault directory and database file, responds with 200 `{ message: 'Restore complete, restarting...' }`, and exits the process after a short delay

#### Scenario: Invalid archive structure
- **WHEN** an admin uploads a `.tar.gz` that does not contain both a `vault/` directory and a `kalepin.sqlite` file at the root
- **THEN** the server responds with 400 Bad Request and a message indicating the expected archive structure, without modifying any data

#### Scenario: Non-admin user denied
- **WHEN** a user without `admin:backup` permission sends `POST /api/admin/backup/restore`
- **THEN** the server responds with 403 Forbidden

#### Scenario: No file provided
- **WHEN** an admin sends `POST /api/admin/backup/restore` without a file attachment
- **THEN** the server responds with 400 Bad Request

### Requirement: Atomic restore with rollback on failure
The restore process SHALL use atomic rename operations for both the vault directory and the database file. If the vault swap fails, the original vault SHALL be restored.

#### Scenario: Vault rename failure triggers rollback
- **WHEN** the rename of the staged vault to the live vault path fails
- **THEN** the server restores the original vault from the `.old` backup and responds with 500

### Requirement: Index auto-rebuild after restore
After a restore-triggered restart, the search service SHALL detect empty embeddings and FTS tables and automatically rebuild all indexes.

#### Scenario: Indexes rebuilt on boot after restore
- **WHEN** the application starts and the `note_embeddings` table is empty
- **THEN** the search service triggers a full reindex of all notes (FTS and embeddings)

