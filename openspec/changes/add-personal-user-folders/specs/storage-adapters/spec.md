## ADDED Requirements

### Requirement: Routing storage adapter for two physical roots

The system SHALL provide a `RoutingStorageAdapter` that wraps two `LocalFSAdapter` instances — one rooted at `VAULT_PATH` and one rooted at `PERSONAL_PATH` — and dispatches every read/write/move/list/exists/stat call by inspecting the virtual path prefix `_users/`.

#### Scenario: Shared path routes to vault adapter
- **WHEN** the routing adapter receives `read("Notes/foo.md")`
- **THEN** the call is delegated to the shared `LocalFSAdapter` rooted at `VAULT_PATH`, with physical path `Notes/foo.md`

#### Scenario: Personal path routes to personal adapter
- **WHEN** the routing adapter receives `read("_users/alice@example.com/Diary.md")`
- **THEN** the call is delegated to the personal `LocalFSAdapter` rooted at `PERSONAL_PATH`, with physical path `alice@example.com/Diary.md`

#### Scenario: Cross-root move performs read-then-write-then-delete
- **WHEN** the routing adapter receives `move("Notes/foo.md", "_users/alice@example.com/foo.md")`
- **THEN** the implementation reads from the shared adapter, writes to the personal adapter, and deletes the original; both endpoints succeed atomically from the caller's perspective

#### Scenario: Cross-personal move rejected
- **WHEN** the routing adapter receives `move("_users/alice@example.com/foo.md", "_users/bob@example.com/foo.md")`
- **THEN** the call is rejected with a typed error before any FS operation occurs

### Requirement: PERSONAL_PATH configuration

The system SHALL accept a `PERSONAL_PATH` environment variable (default `./data/personal`) specifying the physical directory used by the personal `LocalFSAdapter` instance. The directory SHALL be created if absent.

#### Scenario: PERSONAL_PATH unset falls back to single-root
- **WHEN** the backend boots with `PERSONAL_PATH` unset
- **THEN** the storage module constructs a single `LocalFSAdapter` against `VAULT_PATH` and personal-folder features are inactive (no virtual `_users/` routing occurs)

#### Scenario: PERSONAL_PATH set enables routing
- **WHEN** the backend boots with `PERSONAL_PATH=./data/personal`
- **THEN** the storage module constructs a `RoutingStorageAdapter` and personal-folder features are active

### Requirement: Idempotent personal folder creation

The routing adapter SHALL expose `ensurePersonalFolder(email)` that creates `personal/{email}/` if absent and is a no-op otherwise.

#### Scenario: First call creates the folder
- **WHEN** `ensurePersonalFolder("alice@example.com")` is called and the folder does not exist
- **THEN** the folder is created with the same permissions as `VAULT_PATH`

#### Scenario: Repeated calls do not modify mtime
- **WHEN** `ensurePersonalFolder("alice@example.com")` is called and the folder already exists
- **THEN** no FS write occurs and the folder's mtime is unchanged
