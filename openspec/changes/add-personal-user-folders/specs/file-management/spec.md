## MODIFIED Requirements

### Requirement: File controller routes are gated by viewer visibility

Every authenticated route under `/api/files/*` and `/api/vault/*` that accepts a path argument SHALL gate access via the visibility predicate: reads call `assertReadableBy(path, req.user.email)` and writes call `assertWritableBy(path, req.user.email)`. Foreign personal paths SHALL return `404 Not Found`.

#### Scenario: Read of foreign personal path returns 404
- **WHEN** Bob calls `GET /api/files/read?path=_users/alice@example.com/Diary.md`
- **THEN** the response status is `404 Not Found`

#### Scenario: Write into foreign personal path returns 404
- **WHEN** Bob calls `POST /api/files/create` with `{ path: "_users/alice@example.com/Hack.md" }`
- **THEN** the response status is `404 Not Found` and no file is created

#### Scenario: Move with src and dest both visible to caller
- **WHEN** Alice calls `POST /api/files/move` with `{ src: "_users/alice@example.com/A.md", dest: "_users/alice@example.com/B.md" }`
- **THEN** the rename succeeds

#### Scenario: Move where dest crosses into foreign personal namespace
- **WHEN** Alice calls `POST /api/files/move` with `{ src: "Notes/foo.md", dest: "_users/bob@example.com/foo.md" }`
- **THEN** the response status is `404 Not Found` and no FS change occurs

### Requirement: Tree listing filters foreign personal subtrees

The system SHALL ensure `GET /api/files/tree` returns only entries the requester can read: shared entries plus the requester's own `_users/{email}/` subtree (if any). Foreign `_users/{X}/` subtrees SHALL be omitted entirely from the response.

#### Scenario: Tree response excludes foreign personal subtrees
- **WHEN** Bob calls `GET /api/files/tree`
- **THEN** the JSON response contains every shared entry and at most a `_users/bob@example.com` subtree; no element of the response contains the substring `_users/alice@example.com`

#### Scenario: Tree response includes own personal subtree when present
- **WHEN** Alice has notes under `_users/alice@example.com/` and calls `GET /api/files/tree`
- **THEN** the response contains a top-level entry rendering her own personal subtree

### Requirement: Bulk download is layout-B safe-by-construction

The system SHALL implement `GET /api/files/download-zip` by archiving the shared vault root and the requester's own personal subtree only. Foreign personal data SHALL NOT be reachable through the handler.

#### Scenario: Download-zip excludes foreign personal data
- **WHEN** Bob calls `GET /api/files/download-zip` and Alice has notes in her personal folder
- **THEN** the streamed tar contains entries from `vault/` and at most `_users/bob@example.com/...`, and zero entries beginning with `_users/alice@example.com/`

#### Scenario: Download-zip includes own personal subtree
- **WHEN** Alice has 5 personal notes and calls `GET /api/files/download-zip`
- **THEN** the tar contains those 5 notes nested under a virtual `_users/alice@example.com/` directory

### Requirement: Personal folder root segment is non-renamable and non-deletable

The system SHALL reject any operation whose path equals `_users/{email}` (the personal folder's root segment). This applies to `move`, `delete`, and `directory` deletion routes.

#### Scenario: Delete on personal root rejected
- **WHEN** Alice calls `DELETE /api/files/directory?path=_users/alice@example.com`
- **THEN** the response status is `400 Bad Request`

#### Scenario: Move targeting `_users` or `_users/{X}` exactly rejected
- **WHEN** any user calls `POST /api/files/move` with `dest` equal to `_users` or to `_users/{any-email}`
- **THEN** the response status is `400 Bad Request`

### Requirement: Vault `_users/` directory is reserved

The system SHALL refuse to create a top-level shared-vault directory literally named `_users` and SHALL refuse to start if such a directory already exists on disk.

#### Scenario: Creating shared `_users/` returns 400
- **WHEN** any user calls `POST /api/files/directory` with `{ path: "_users" }`
- **THEN** the response status is `400 Bad Request`

#### Scenario: Boot fails if shared `_users/` exists
- **WHEN** the backend starts with a pre-existing `VAULT_PATH/_users/` directory
- **THEN** the process logs a fatal error and exits non-zero
