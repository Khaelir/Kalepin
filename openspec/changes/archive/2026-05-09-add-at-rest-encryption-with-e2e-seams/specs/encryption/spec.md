# Spec delta: encryption (NEW)

## ADDED Requirements

### Requirement: Files under encrypted zones are stored as opaque envelopes on disk

The system SHALL encrypt every file written under any zone whose `enabled` flag is true, using AES-256-GCM with a per-file random Content Encryption Key (CEK) wrapped by the configured server KEK. The resulting envelope SHALL conform to the v1 envelope format with magic bytes `KE1\0` as the first four bytes of the file.

#### Scenario: Personal-folder note is an envelope on disk
- **GIVEN** the `personal` zone has `enabled = 1`
- **WHEN** a user writes `_users/alice@x.com/diary.md` with content `# diary`
- **THEN** the file at `PERSONAL_PATH/alice@x.com/diary.md` begins with `KE1\0`
- **AND** the API `GET /api/files/read?path=_users/alice@x.com/diary.md` returns `# diary`

#### Scenario: Shared-vault note remains plaintext when zone is disabled
- **GIVEN** the `shared` zone has `enabled = 0` (default)
- **WHEN** a user writes `Notes/team.md` with content `# team`
- **THEN** the file at `VAULT_PATH/Notes/team.md` is exactly `# team`

### Requirement: Reads auto-detect envelope vs plaintext

The system SHALL inspect the first four bytes of any file read through `EncryptingStorageAdapter`. If they equal `KE1\0`, the file SHALL be decrypted using the configured KEK source. Otherwise, the bytes SHALL be returned verbatim.

#### Scenario: Plaintext file in an encrypted zone is still readable
- **GIVEN** the `shared` zone is mid-sweep encrypting (some files already envelopes, some still plaintext)
- **WHEN** the API reads a plaintext file under the zone
- **THEN** the response is the plaintext content

### Requirement: Wrong-KEK reads fail fast with a clear error

The envelope SHALL include an 8-byte KEK fingerprint computed as `HMAC-SHA256(KEK, "kalepin-kek-fp")[:8]`. On read, the adapter SHALL compare the envelope fingerprint to the current KEK source's fingerprint. On mismatch, the adapter SHALL throw `WrongKEKError` with both fingerprints surfaced before attempting AEAD decryption.

#### Scenario: Restore with wrong KEK surfaces the mismatch
- **GIVEN** a backup was taken with KEK fingerprint `a3f9...e2b1`
- **AND** the system boots with a different KEK whose fingerprint is `5c44...0d77`
- **WHEN** any encrypted file is read
- **THEN** the request fails with a 500 whose log line contains both fingerprints

### Requirement: AAD binds the path to prevent ciphertext-swap attacks

The envelope's AAD field SHALL contain a UTF-8 JSON object with the keys `v` (format version), `path` (virtual path), `kind` (`note` | `attachment` | `meta`), and `z` (zone). On decrypt, the adapter SHALL re-compute the AAD from the call site's parameters and pass it to AES-GCM. A mismatch (e.g., ciphertext copied from `journal.md` to `groceries.md`) SHALL cause the AEAD tag check to fail.

#### Scenario: Renaming the file on disk invalidates the AAD
- **GIVEN** an encrypted file at `_users/alice/foo.md`
- **WHEN** an operator renames the on-disk file to `_users/alice/bar.md` directly (bypassing the API)
- **THEN** an API read at `bar.md` fails with `BadAEADTag` (the AAD `path` no longer matches)

### Requirement: KEK source is configurable via interface

The system SHALL load its KEK through a `KEKSource` interface with at least two implementations: `FileKEKSource` (default, reads from `KALEPIN_KEK_FILE`) and `EnvKEKSource` (`KALEPIN_KEK`, dev-only). The interface SHALL expose `wrap(cek)`, `unwrap(wrappedCek)`, and `fingerprint`.

#### Scenario: File source rejects insecure mode
- **GIVEN** `KALEPIN_KEK_FILE` exists at mode `0644`
- **WHEN** the application boots
- **THEN** the application refuses to start with a clear error mentioning the required mode

#### Scenario: Env source refuses production
- **GIVEN** `NODE_ENV=production` and `KALEPIN_KEK_FILE` is unset and `KALEPIN_KEK` is set
- **WHEN** the application boots
- **THEN** the application refuses to start with an error directing the operator to use a file source

### Requirement: Per-zone admin toggle controls encryption state

The system SHALL expose admin-only HTTP endpoints under `/api/admin/encryption` allowing an admin to flip each zone (`personal`, `shared`) between encrypted and plaintext, and to read the current state and any in-progress migration. Endpoints SHALL be gated by the `admin:backup` scope.

#### Scenario: Admin reads current encryption state
- **WHEN** an admin calls `GET /api/admin/encryption`
- **THEN** the response is `{ "zones": [{ "zone": "personal", "enabled": true, ... }, { "zone": "shared", "enabled": false, ... }] }`

#### Scenario: Admin enables shared-zone encryption
- **GIVEN** the `shared` zone has `enabled = 0`
- **WHEN** an admin calls `POST /api/admin/encryption/zones/shared/encrypt`
- **THEN** the response is `202 Accepted`
- **AND** within an implementation-defined time, every file under `VAULT_PATH` begins with `KE1\0`
- **AND** subsequent API reads still return plaintext

#### Scenario: Admin disables personal-zone encryption
- **GIVEN** the `personal` zone has `enabled = 1`
- **WHEN** an admin calls `POST /api/admin/encryption/zones/personal/decrypt`
- **THEN** the response is `202 Accepted`
- **AND** within an implementation-defined time, no file under `PERSONAL_PATH` begins with `KE1\0`
- **AND** subsequent API reads still return plaintext

#### Scenario: Non-admin call rejected
- **WHEN** a non-admin user calls `POST /api/admin/encryption/zones/shared/encrypt`
- **THEN** the response is `403 Forbidden`

### Requirement: Migration sweep is crash-safe and resumable

The migration sweep SHALL persist `migration_state` and `migration_progress` after each batch of files. On process restart, an `encrypting` or `decrypting` zone SHALL resume from the persisted progress. Per-file writes SHALL use atomic write-tmp + fsync + rename.

#### Scenario: Crash mid-sweep is recoverable
- **GIVEN** an encryption sweep at progress 432/1000
- **WHEN** the process is killed and restarted
- **THEN** the sweep resumes; the final state has all 1000 files as envelopes with no data loss

### Requirement: Migration sweep skips E2E paths

The sweep SHALL skip any path where the `isE2EEncrypted` predicate returns true. Such paths are owned by stage 2 and are not server-keyed.

#### Scenario: Stage 2 path is skipped during personal-zone sweep
- **GIVEN** stub: `isE2EEncrypted('_users/alice/_secure/journal.md') === true`
- **WHEN** an admin runs an encrypt sweep on the `personal` zone
- **THEN** the file at that path is not touched; its on-disk bytes are unchanged

### Requirement: Six predicates serve as stage-2 seams

The system SHALL define and consult the following predicates throughout the codebase: `isEncryptedAtRest`, `isE2EEncrypted`, `shouldIndexPlaintext`, `canCollab`, `commentBodiesEncrypted`, `shareLinkMintable`. In stage 1, only `isEncryptedAtRest` is data-driven (per `encryption_zones` table); the others return constants. Every call site that filters by these predicates SHALL consult them through the central predicate module, not via hardcoded path checks.

#### Scenario: Stage 2 flips a predicate without changing call sites
- **GIVEN** stage 1 ships with `shouldIndexPlaintext` returning true everywhere
- **AND** stage 2 changes `shouldIndexPlaintext(path)` to return `!isE2EEncrypted(path)`
- **WHEN** stage 2 ships
- **THEN** FTS / semantic / link-index correctly skip indexing for `_secure/` paths without any modification to those services
