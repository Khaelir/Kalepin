## ADDED Requirements

### Requirement: Download backup archive endpoint
The system SHALL expose `GET /api/admin/backup/download` that creates a light `.tar.gz` archive (vault directory + SQLite database stripped of embeddings and FTS indexes) and streams it to the client as a file download.

#### Scenario: Successful download
- **WHEN** an authenticated admin sends `GET /api/admin/backup/download`
- **THEN** the server creates a `.tar.gz` archive containing the `vault/` directory and `kalepin.sqlite` (without `note_embeddings`, `notes_fts`, `comments_fts` tables), and responds with `Content-Type: application/gzip`, `Content-Disposition: attachment; filename=kalepin-backup-{ISO-timestamp}.tar.gz`, streaming the archive body

#### Scenario: Non-admin user denied
- **WHEN** a user without `admin:backup` permission sends `GET /api/admin/backup/download`
- **THEN** the server responds with 403 Forbidden

#### Scenario: Temp files cleaned up
- **WHEN** the archive has been fully streamed (or the connection is aborted)
- **THEN** the server removes the temporary directory used for archive creation
