## ADDED Requirements

### Requirement: Personal folder identity by email

The system SHALL provide each authenticated user a private namespace addressed by the virtual path prefix `_users/{email}/`, where `{email}` is the user's lowercased email. The namespace SHALL be stable across DB rebuilds because the on-disk folder name is the email itself, not a database-generated id.

#### Scenario: Personal namespace path uses lowercased email
- **WHEN** a user with email `Alice@Example.COM` interacts with the system
- **THEN** their personal folder virtual path is exactly `_users/alice@example.com/`

#### Scenario: Folder name survives DB recovery
- **WHEN** the database is restored from a vault-only backup and the user logs in fresh, receiving a new autoincrement `id`
- **THEN** their existing personal folder at `personal/alice@example.com/` is reattached transparently, since the folder name is the email and matches the JWT-issued email

### Requirement: Visibility predicate is the single source of truth

The system SHALL gate every read, write, list, search, link, comment, change feed, attachment, share-link, OT, MCP, and WebSocket emission of a virtual path or path-derived content through a single predicate `isVisibleTo(virtualPath, viewerEmail)`. The predicate SHALL return true exactly when the path is not under `_users/` OR the path equals `_users/{viewerEmail}` OR the path begins with `_users/{viewerEmail}/`.

#### Scenario: Shared paths are visible to everyone
- **WHEN** any authenticated user requests `Notes/foo.md`
- **THEN** `isVisibleTo` returns true regardless of the requester's email

#### Scenario: Personal path is visible to its owner
- **WHEN** the user `alice@example.com` requests `_users/alice@example.com/Diary.md`
- **THEN** `isVisibleTo` returns true

#### Scenario: Personal path is invisible to non-owners
- **WHEN** the user `bob@example.com` requests `_users/alice@example.com/Diary.md`
- **THEN** `isVisibleTo` returns false

#### Scenario: Personal root segment itself is visible to its owner only
- **WHEN** `alice@example.com` lists `_users/alice@example.com`
- **THEN** the predicate permits it; the same listing as `bob@example.com` is rejected

### Requirement: Foreign personal paths return 404 Not Found

The system SHALL respond with `404 Not Found` for any request — HTTP, WebSocket, or MCP — that targets a path the requester cannot read. The system SHALL NOT respond with `403 Forbidden` for foreign personal paths because a `403` reveals existence.

#### Scenario: Foreign personal read returns 404, not 403
- **WHEN** Bob calls `GET /api/files/read?path=_users/alice@example.com/Diary.md`
- **THEN** the response status is 404 with the same response body shape as a request for a path that does not exist on either root

#### Scenario: WebSocket doc:open of foreign personal docId is rejected
- **WHEN** Bob's authenticated WebSocket sends `doc:open` with `{ docId: "_users/alice@example.com/Diary.md" }`
- **THEN** the gateway sends an error event indicating the doc was not found and does not transmit content

#### Scenario: MCP read_note of foreign personal path returns 404-equivalent
- **WHEN** Bob's MCP client calls `read_note` with `path = "_users/alice@example.com/Diary.md"`
- **THEN** the tool returns the same not-found response it returns for a genuinely nonexistent path

### Requirement: Personal folder root segment is non-renamable and non-deletable

The system SHALL reject any attempt to rename, move, or delete the path `_users/{email}` itself. Children of the personal folder SHALL behave normally.

#### Scenario: Move with src equal to personal root rejected
- **WHEN** Alice calls `POST /api/files/move` with `{ src: "_users/alice@example.com", dest: "Renamed" }`
- **THEN** the system returns `400 Bad Request` and does not modify any path

#### Scenario: Delete on personal root rejected
- **WHEN** Alice calls `DELETE /api/files/directory?path=_users/alice@example.com`
- **THEN** the system returns `400 Bad Request` and does not delete the directory

#### Scenario: Children of the personal folder are normally editable
- **WHEN** Alice renames `_users/alice@example.com/Old.md` to `_users/alice@example.com/New.md`
- **THEN** the rename succeeds and behaves identically to renames in the shared vault

### Requirement: Personal folder is auto-created on first authenticated request

The system SHALL ensure the on-disk personal folder for a user exists by the time their first authenticated request after login completes.

#### Scenario: First login creates the personal folder
- **WHEN** a user logs in for the first time and makes any authenticated request
- **THEN** `personal/{email}/` exists on disk afterward

#### Scenario: Subsequent logins are idempotent
- **WHEN** a user with an existing `personal/{email}/` folder authenticates again
- **THEN** no on-disk modification is performed and the request succeeds

### Requirement: Foreign vault directory named `_users` is rejected at the shared vault root

The system SHALL refuse to create, accept, or boot with a top-level shared-vault directory literally named `_users`. The prefix is reserved for personal-folder routing.

#### Scenario: Creating shared vault `_users/` directory rejected
- **WHEN** any user calls `POST /api/files/directory` with `{ path: "_users" }`
- **THEN** the system returns `400 Bad Request`

#### Scenario: Boot with pre-existing `vault/_users/` aborts
- **WHEN** the backend starts and `VAULT_PATH/_users/` exists on disk
- **THEN** boot fails with a fatal log message and the process exits non-zero

### Requirement: Bulk download includes only requester-visible content

The system SHALL ensure that any per-user bulk download (`download-zip`) yields a tar containing the shared vault and at most the requester's own personal subtree. The download SHALL NOT contain any other user's personal content under any circumstance.

#### Scenario: Bob's download-zip excludes Alice's personal content
- **WHEN** Bob calls `GET /api/files/download-zip`
- **THEN** the streamed tar contains entries from `vault/` and at most `_users/bob@example.com/...`, and contains zero entries whose path begins with `_users/alice@example.com/`

#### Scenario: Layout B makes foreign exclusion structural
- **WHEN** the download-zip handler runs
- **THEN** the handler references the shared adapter's `vault/` root and the requester's `personal/{email}/` root only; foreign personal data is structurally unreachable rather than filtered

### Requirement: Admin export includes all roots

The system SHALL provide an admin-only endpoint `GET /api/admin/export-zip` that returns the union of the shared vault and every personal folder. The endpoint SHALL be gated by the `admin:backup` scope.

#### Scenario: Admin export contains all personal subtrees
- **WHEN** an admin calls `GET /api/admin/export-zip`
- **THEN** the streamed tar contains entries from `vault/` and from every `personal/{email}/` directory present on disk

#### Scenario: Non-admin call rejected
- **WHEN** a non-admin authenticated user calls `GET /api/admin/export-zip`
- **THEN** the system returns `403 Forbidden`

### Requirement: Backups archive both roots

The system SHALL include both the shared vault and every personal folder in scheduled S3 backups and in the archive returned by `archiveService.createArchive()`.

#### Scenario: S3 backup contains both roots
- **WHEN** the scheduled backup runs
- **THEN** the resulting tar in S3 contains `vault/...` and `personal/.../...` entries

#### Scenario: Restore round-trips both roots byte-identically
- **WHEN** a backup is restored on a fresh instance
- **THEN** both `VAULT_PATH/...` and `PERSONAL_PATH/...` are byte-identical to the source instance at backup time

### Requirement: Soft-delete on user removal

The system SHALL preserve a deleted user's personal folder by moving it to `personal/.deleted/{email}-{ISO timestamp}/` rather than removing it.

#### Scenario: User deletion preserves personal content
- **WHEN** the User row for `alice@example.com` is deleted
- **THEN** `personal/alice@example.com/` is moved to `personal/.deleted/alice@example.com-{timestamp}/` and remains queryable on disk

#### Scenario: Re-registration with the same email starts fresh
- **WHEN** a fresh user registers with `alice@example.com` after a prior soft-delete
- **THEN** a new empty `personal/alice@example.com/` is created and the prior `.deleted/alice@example.com-{timestamp}/` content is NOT auto-merged

### Requirement: Personal-folder leak-token property holds across the entire surface

The system SHALL satisfy a property: for any unique tokens `PATHTOK`, `BODYTOK`, `ATTACHTOK`, `COMMENTTOK` placed in Alice's personal folder name, body, attachment name, and comment text respectively, no authenticated request, WebSocket event, MCP tool response, or downloadable archive issued under Bob's identity SHALL contain any of those tokens or the literal `_users/alice@example.com` anywhere in its serialized output.

#### Scenario: Token-scan property is checked across every controller and tool
- **WHEN** the leak-token e2e suite runs against the integrated stack with discovery from Nest router metadata and MCP tool registry
- **THEN** the property holds for every discovered HTTP route, every MCP tool, every WebSocket event type, and the download-zip tar entries

#### Scenario: Adding a new route preserves the property structurally
- **WHEN** a developer adds a new HTTP controller, MCP tool, or WebSocket event type
- **THEN** route discovery in the test harness includes it automatically; if the new route emits a leak token under Bob's identity, CI fails before merge
