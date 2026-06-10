## MODIFIED Requirements

### Requirement: Per-namespace attachments directories

The system SHALL store attachments in per-namespace directories: `vault/_attachments/` for shared notes and `personal/{email}/_attachments/` for each user's personal notes. Attachments uploaded against a doc whose path is under `_users/{email}/` SHALL be written to that user's personal `_attachments/` directory.

#### Scenario: Upload from shared note lands in shared attachments
- **WHEN** a user calls `POST /api/files/upload` with `docPath = "Notes/foo.md"`
- **THEN** the attachment is written to `VAULT_PATH/_attachments/{name}`

#### Scenario: Upload from personal note lands in owner's personal attachments
- **WHEN** Alice calls `POST /api/files/upload` with `docPath = "_users/alice@example.com/Diary.md"`
- **THEN** the attachment is written to `PERSONAL_PATH/alice@example.com/_attachments/{name}`

### Requirement: Attachment serve route resolves namespace from optional doc-context hint

`GET /api/files/attachment` SHALL accept `name` (required) and `doc` (optional). When `doc` is absent, the backend SHALL resolve from `vault/_attachments/{name}` — preserving the legacy URL contract used by every existing markdown embed. When `doc` is present, the backend SHALL first call `assertReadableBy(doc, requesterEmail)` and reject with `404 Not Found` on failure, then derive the namespace from `doc`'s prefix: `_users/{requesterEmail}/...` resolves to that user's personal attachments dir; otherwise to the shared dir. The requester's email comes exclusively from `req.user`, never from a query parameter.

#### Scenario: Legacy URL without doc resolves to shared
- **WHEN** any authenticated user calls `GET /api/files/attachment?name=img.png`
- **THEN** the file is served from `vault/_attachments/img.png`, byte-identical to pre-change behavior

#### Scenario: Personal attachment served only to its owner via doc hint
- **WHEN** Alice calls `GET /api/files/attachment?name=secret.png&doc=_users/alice@example.com/Diary.md`
- **THEN** `assertReadableBy("_users/alice@example.com/Diary.md", "alice@example.com")` passes, namespace is derived as personal, and the file is served from `personal/alice@example.com/_attachments/secret.png`

#### Scenario: Personal attachment not reachable by non-owner via crafted doc hint
- **WHEN** Bob calls `GET /api/files/attachment?name=secret.png&doc=_users/alice@example.com/Diary.md`
- **THEN** the response status is `404 Not Found` because `assertReadableBy("_users/alice@example.com/Diary.md", "bob@example.com")` rejects the doc before any file lookup. The 404 is byte-equivalent to a request for a doc that does not exist on either root

#### Scenario: Move across personal/shared boundary preserves attachment renders
- **WHEN** a doc with attachments moves from shared to personal (or back), and the doc is re-rendered after the move
- **THEN** every embedded attachment still resolves because `FilesService.move` physically copied each referenced attachment file into the destination namespace's `_attachments/` directory

### Requirement: Attachment cleanup walks every namespace

The system SHALL extend orphan-attachment cleanup to walk both `vault/_attachments/` and every `personal/{email}/_attachments/` directory. Orphan-detection SHALL be per-namespace.

#### Scenario: Shared cleanup unaffected
- **WHEN** the cleanup runs and the shared `_attachments/` has orphan files
- **THEN** they are moved to the trash subdirectory under `vault/_attachments/.trash/` as before

#### Scenario: Per-user cleanup
- **WHEN** the cleanup runs and Alice's `personal/alice@example.com/_attachments/` has orphan files
- **THEN** they are moved to `personal/alice@example.com/_attachments/.trash/`
