# Spec delta: access-metadata (NEW)

## ADDED Requirements

### Requirement: Reads, edits, comments, and share resolves are logged

The system SHALL append a row to `note_access_log` for each of: `GET /api/files/read`, write/edit operations on a path, `POST /api/comments`, and `GET /share/:code`. The row SHALL contain the canonical viewer email (or `'anonymous'`), the action, an IP hash, and a timestamp.

#### Scenario: View is logged
- **WHEN** Alice calls `GET /api/files/read?path=Notes/foo.md`
- **THEN** a row exists with `path='Notes/foo.md'`, `viewer_email='alice@x.com'`, `action='view'`

#### Scenario: Anonymous share resolve is logged
- **WHEN** an unauthenticated client opens `/share/abc123` for a note at `Notes/foo.md`
- **THEN** a row exists with `viewer_email='anonymous'`, `action='share-link-resolved'`

### Requirement: Edits are deduped within a 60-second window

Repeated edit events from the same `(path, viewer)` within 60 seconds SHALL produce only the first row.

#### Scenario: Rapid edits log once
- **WHEN** Alice saves the same note 30 times within 30 seconds
- **THEN** exactly one `'edit'` row exists for that path/viewer pair

### Requirement: Owner and admin read the log; others get 403

`GET /api/notes/:path/access-log` SHALL succeed only when the requester owns the path or is an admin.

#### Scenario: Owner reads
- **GIVEN** Alice owns `_users/alice/foo.md`
- **WHEN** Alice calls `GET /api/notes/_users%2Falice%2Ffoo.md/access-log`
- **THEN** the response is 200 with rows

#### Scenario: Non-owner blocked
- **WHEN** Bob calls the same endpoint for Alice's path
- **THEN** the response is 403 (or 404 per visibility rules in the personal-folder capability)

### Requirement: Retention prunes old rows daily

A daily cron SHALL delete rows older than `ACCESS_LOG_RETENTION_DAYS` (default 90).

#### Scenario: Old rows pruned
- **GIVEN** retention = 30 days, a row at `ts = now - 31 days`
- **WHEN** the daily cron runs
- **THEN** the row is deleted

### Requirement: Right-to-erasure deletes the requester's rows

`DELETE /api/users/me/access-log` SHALL delete all rows where `viewer_email` equals the requester's canonical email and return the count deleted.

#### Scenario: User erases their log
- **GIVEN** Alice has 42 rows logged
- **WHEN** Alice calls `DELETE /api/users/me/access-log`
- **THEN** the response is `{ deleted: 42 }` and zero rows remain with `viewer_email = 'alice@x.com'`

#### Scenario: Admin erases another user's log
- **GIVEN** an admin
- **WHEN** the admin calls `DELETE /api/admin/users/bob@x.com/access-log`
- **THEN** all rows where `viewer_email='bob@x.com'` are deleted

### Requirement: E2E reads log as `'fetched'`, not `'view'`

When the read path resolves to an `isE2EEncrypted` path, the action value SHALL be `'fetched'`. The frontend ActivityPanel SHALL label these accordingly.

#### Scenario: E2E read distinguishes the action
- **GIVEN** stub `isE2EEncrypted('_users/alice/_secure/journal.md') === true`
- **WHEN** Alice reads that path
- **THEN** the row's `action = 'fetched'`
