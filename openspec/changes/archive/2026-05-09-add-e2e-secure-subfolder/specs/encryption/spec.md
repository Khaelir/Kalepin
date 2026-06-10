# Spec delta: encryption (MODIFIED)

## ADDED Requirements

### Requirement: `_users/{email}/_secure/` is reserved as the E2E zone

The system SHALL treat the path segment `_secure` directly under any `_users/{email}/` as a reserved subfolder. Files under `_users/{email}/_secure/...` SHALL be end-to-end encrypted: the server holds ciphertext only, and the wrapped CEK is wrapped against a passphrase-derived KEK that never leaves the user's browser.

#### Scenario: Predicate identifies E2E paths
- **WHEN** `isE2EEncrypted('_users/alice@x.com/_secure/journal.md')` is called
- **THEN** the result is `true`
- **WHEN** `isE2EEncrypted('_users/alice@x.com/notes/foo.md')` is called
- **THEN** the result is `false`
- **WHEN** `isE2EEncrypted('vault/_secure/foo.md')` is called
- **THEN** the result is `false` (E2E only applies under `_users/{email}/`)

### Requirement: Server stores opaque envelopes for E2E paths

For paths where `isE2EEncrypted(path)` returns true, the `EncryptingStorageAdapter.write` SHALL accept ciphertext bytes verbatim (rejecting non-envelope input with 400) and `read` SHALL return the on-disk bytes verbatim. The server SHALL NOT attempt server-side decryption.

#### Scenario: Server-side decrypt is impossible
- **GIVEN** Alice has uploaded an E2E envelope at `_users/alice@x.com/_secure/journal.md`
- **WHEN** any server-side code calls `storage.read(path)` for that path
- **THEN** the response is the raw envelope bytes (the server has no KEK to decrypt)

### Requirement: Move-to-`_secure/` revokes grants, deletes share-links, clears PIN

The endpoint that converts a plaintext or at-rest path to an E2E path SHALL atomically: revoke all active grants on the source path, delete all share-links pointing to the source path, clear the PIN, and replace the on-disk content with a client-supplied envelope. The UI SHALL confirm these consequences before invoking the endpoint.

#### Scenario: Move-to-secure side effects
- **GIVEN** Alice's `_users/alice/foo.md` has 2 active grants, 1 share-link, and a PIN
- **WHEN** Alice POSTs `/api/files/move-to-secure` with the new envelope
- **THEN** in a single transaction: grants are revoked, share-links deleted, PIN cleared, file moved to `_users/alice/_secure/foo.md`

### Requirement: Two-tier key hierarchy with a master KEK

The system SHALL store per-file CEKs wrapped against a randomly-generated 256-bit master KEK, NOT directly against a passphrase-derived key. The master KEK SHALL be stored on the server only in wrapped form, with two possible wrappers: a passphrase-wrapped copy (`user_meta.passphrase_wrapped_kek`, always present after vault setup) and an optional recovery-wrapped copy (`user_meta.recovery_wrapped_kek`, present only when the user opted into recovery codes). The master KEK SHALL be cached in the user's browser as a non-extractable `CryptoKey` in IndexedDB. The envelope's `kek_fingerprint` SHALL be `HMAC(master-KEK, "kalepin-kek-fp")[:8]` so the fingerprint is stable across passphrase rotations.

#### Scenario: Per-file envelope references master KEK fingerprint
- **GIVEN** Alice has set up a vault with master-KEK `M`
- **WHEN** Alice creates a `_secure/` file with envelope `E`
- **THEN** `E.kek_fingerprint` equals `HMAC(M, "kalepin-kek-fp")[:8]`
- **AND** `E.wrapped_cek` equals `AES-KW(M, file's CEK)`
- **WHEN** Alice rotates her passphrase
- **THEN** `E` is unchanged; only `user_meta.passphrase_wrapped_kek` and `user_meta.passphrase_salt` change

### Requirement: Recovery codes are opt-in and never exposed to the server

The system MAY support a recovery-code flow that derives a recovery KEK from a 24-word BIP-39 phrase via Argon2id with a separate `recovery_salt`. The recovery KEK SHALL AES-KW-wrap the master KEK; the wrapped blob SHALL be stored at `user_meta.recovery_wrapped_kek`. The recovery phrase itself SHALL never be transmitted to the server. The setup UI SHALL show the recovery phrase exactly once and SHALL require the user to type a specific word from the phrase to confirm they have written it down before dismissing the dialog.

#### Scenario: Recovery phrase is shown once with confirmation challenge
- **WHEN** the user opts into recovery codes during setup
- **THEN** the dialog displays the 24-word phrase exactly once
- **AND** requires the user to type a specific word (e.g., "type word 6") to confirm before the dialog can be dismissed
- **AND** the phrase is never persisted client-side or transmitted server-side

#### Scenario: Recovery flow unwraps master KEK
- **GIVEN** Alice generated a recovery phrase during setup; the wrapped KEK is at `user_meta.recovery_wrapped_kek`
- **WHEN** Alice forgets her passphrase and enters the recovery phrase
- **THEN** the client derives the recovery KEK, fetches `recovery_wrapped_kek`, unwraps the master KEK, and caches it as a non-extractable CryptoKey

### Requirement: Lost passphrase without a recovery code is unrecoverable, with typed-confirmation gate at setup

The system SHALL document that a lost passphrase, without a recovery code, makes E2E content permanently unreadable. The setup UI SHALL block creation of the vault until the user has:
1. Typed the passphrase in two separate fields that match exactly,
2. Achieved a zxcvbn strength score of at least 3,
3. Typed the literal string "I understand" (case-insensitive, trimmed) in a separate confirmation field that follows a visible warning naming the consequence ("no Kalepin operator, admin, or staff member can recover the contents"),
4. Made an explicit choice (skip vs. generate) on recovery codes — no implicit default.

A checkbox-only acknowledgement of the consequence SHALL NOT be sufficient. The dialog's "Create vault" button SHALL be disabled until all four conditions hold.

#### Scenario: Setup UI enforces typed confirmation
- **WHEN** the user fills the passphrase fields and the strength meter shows ≥ 3
- **AND** the user has not yet typed "I understand"
- **THEN** the "Create vault" button is disabled
- **WHEN** the user types "I understand" in the confirmation field
- **AND** the user has explicitly chosen a recovery option
- **THEN** the "Create vault" button becomes enabled

#### Scenario: Checkbox-only acknowledgement is not sufficient
- **WHEN** the setup UI is implemented with a checkbox instead of a typed-confirmation field
- **THEN** the implementation does not satisfy this requirement

### Requirement: Passphrase rotation re-wraps only the master KEK

The system SHALL provide a passphrase-rotation flow that, when invoked, derives a new passphrase-KEK from the new passphrase and a freshly-generated `passphrase_salt`, AES-KW-wraps the cached master KEK with the new passphrase-KEK, and atomically replaces both `user_meta.passphrase_wrapped_kek` and `user_meta.passphrase_salt`. Per-file envelopes under `_secure/` SHALL NOT be modified during passphrase rotation. The rotation flow SHALL apply the same typed-confirmation gate as the setup flow.

#### Scenario: Routine passphrase rotation does not touch envelopes
- **GIVEN** Alice has 100 files in `_secure/` and the vault is currently unlocked
- **WHEN** Alice rotates her passphrase via Settings → Security
- **THEN** `user_meta.passphrase_wrapped_kek` and `user_meta.passphrase_salt` are replaced
- **AND** all 100 envelope blobs on disk are byte-identical to their pre-rotation state
- **AND** the master-KEK fingerprint (and therefore every `kek_fingerprint` field) is unchanged

#### Scenario: Forced rotation after recovery unlock
- **GIVEN** Alice unlocked her vault via recovery phrase (not passphrase)
- **WHEN** the unlock completes
- **THEN** the client transitions to a "rotation-required" state
- **AND** the user cannot navigate away from the rotation form until a new passphrase is set
- **AND** every subsequent `_secure/` access until rotation succeeds shows a banner "your vault is unlocked via recovery phrase only — please set a new passphrase"

### Requirement: Vault-reset escape hatch with typed-email confirmation and soft-delete grace period

The system SHALL provide a self-service "Reset _secure/ vault" flow available from Settings → Security that does NOT require knowledge of the passphrase or recovery phrase. The flow SHALL be authenticated via the user's existing logged-in session.

The flow SHALL:
1. Display a destructive-action dialog naming the file count and listing the affected paths.
2. Require the user to type their own email address verbatim in a confirmation field (validated server-side, constant-time, against the authenticated user's email) before the request is accepted.
3. On submission, atomically (a) rename `_users/{email}/_secure/` to `_users/{email}/_secure.tombstone-{timestamp}/`, (b) NULL out `passphrase_wrapped_kek`, `recovery_wrapped_kek`, `passphrase_salt`, `recovery_salt`, and `vault_setup_at` in user_meta, (c) record `vault_tombstone_at` and `vault_tombstone_path` for the grace-period sweep, (d) emit a `vault.reset` change-tracking event (metadata-only — paths, count, timestamp), (e) enqueue an email to the user with an HMAC-signed undo link valid for 24 hours.
4. Provide an undo endpoint that, given the valid undo token within 24 hours, restores the tombstoned directory and the previous user_meta fields.
5. Run a background sweep that, after 24 hours, permanently unlinks tombstoned directories and emits a `vault.reset.finalized` event.

The user SHALL be able to set up a fresh vault with a new passphrase immediately after a successful reset (no waiting for the grace period to expire).

#### Scenario: Reset requires typed email
- **GIVEN** Alice's authenticated session
- **WHEN** Alice POSTs `/api/users/me/secure-vault/reset` with `confirm_email = "alice@example.com"`
- **AND** Alice's authenticated email is `alice@example.com`
- **THEN** the request succeeds
- **WHEN** Alice POSTs with `confirm_email = "ALICE@example.com"` (different case) or any other string
- **THEN** the request is rejected with 400

#### Scenario: Reset is recoverable within 24 hours
- **GIVEN** Alice triggered a reset 1 hour ago; the tombstone directory exists; she received the undo email
- **WHEN** Alice clicks the undo link
- **THEN** the tombstoned directory is renamed back to `_users/{alice}/_secure/`
- **AND** the previous user_meta fields are restored from the audit row
- **AND** Alice can unlock the vault with her original passphrase or recovery phrase as if the reset never happened

#### Scenario: Reset finalizes irrevocably after 24 hours
- **GIVEN** Alice triggered a reset 25 hours ago; the background sweep has run
- **THEN** the tombstone directory has been `rm -rf`'d
- **AND** the undo link returns "expired"
- **AND** a `vault.reset.finalized` event is recorded in change-tracking

#### Scenario: Fresh vault after reset has a new master-KEK
- **GIVEN** Alice triggered a reset and finalized; she creates a new vault with a new passphrase
- **THEN** the new master-KEK has a different fingerprint from the destroyed one
- **AND** none of the (already-deleted) old envelope blobs are referenceable by the new vault
