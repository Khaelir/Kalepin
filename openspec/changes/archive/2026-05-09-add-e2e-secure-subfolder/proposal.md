# Add end-to-end encryption for `_users/{email}/_secure/`

> **Status at archive (2026-05-09):** Backend pipeline complete and tested. **The user-facing UI remains hidden behind the `E2E_SECURE_FOLDER` feature flag (default off) and SHALL stay hidden until a follow-up change reworks the editor experience.** See the archived sibling change `openspec/changes/archive/2026-05-09-hide-secure-folder-ui/` for the gating mechanism. Re-enable is blocked on editor parity (the textarea-based `SecureEditor` lacks slash menu, tables, mermaid, wikilinks, mentions, image embeds). A future change should ship a richer secure editor — the leading candidate is a read-only Tiptap preview over raw-markdown source mode, which avoids the metadata-leak decision around wikilink/mention autocomplete. Until that change ships and lands, do NOT flip `E2E_SECURE_FOLDER` to on by default.

## Prerequisites — apply these changes first

This change MUST NOT be implemented until the following sibling changes have been applied (or archived):

1. **`add-per-note-pin`** — provides `DELETE /api/notes/:path/pin` (or equivalent) used by the move-into-`_secure/` flow to clear the PIN. Also already includes the carve-out that rejects PIN setting on `isE2EEncrypted` paths.
2. **`add-shared-with-me-grants`** — provides `document_grants` table, `DELETE /api/grants/:id`, and the path-scoped revocation hook used by the move-into-`_secure/` flow to revoke all grants on the source path. Also already includes the carve-out that rejects granting on `isE2EEncrypted` paths.

If either of these is not yet complete when starting this change, stop and apply them first. Do NOT stub, no-op, or skip the move-into-`_secure/` integration; the destructive-revocation guarantee is load-bearing for the security model and must be wired against the real implementations.

A future session running `openspec list` will see all three changes; this prerequisite block is the canonical signal that this change is downstream of the other two.

## Why

Stage 1 (`add-at-rest-encryption-with-e2e-seams`) defends Kalepin against backup leaks and disk theft, but the server still has the KEK. A live server compromise, a malicious admin, or a subpoena breaks stage 1's guarantee. For the subset of users who want **"not even I, the admin, can read this, ever"**, this change adds a true end-to-end encrypted zone: `_users/{email}/_secure/`. Keys live in the user's browser only, derived from a passphrase via Argon2id.

The seams are already in place from stage 1: the envelope format, the predicate hooks, the `KEKSource` interface, the change-tracking metadata-only branch, the contract for every server-side feature that consults plaintext. Stage 2 is the final flip — implement the client-side crypto, add the passphrase UX, and turn the predicates from constants into per-path checks. The server loses the ability to read content in `_secure/`; in exchange, the user gets a guaranteed-private zone.

The trade-off is real and steep. Server-side features fall away inside `_secure/`: no FTS, no semantic search, no backlinks, no OT collaboration, no comments, no share-links, no MCP read access, no diff in the change feed. The user opts into this carve-out folder by folder, eyes open.

## What Changes

- **New folder semantics**: `_users/{email}/_secure/` is a reserved subfolder name. Once it exists for a user, every file and subfolder under it is end-to-end encrypted. The folder name `_secure` is reserved at the namespace level — files cannot be renamed into or out of it without an explicit "convert" action.
- **Two-tier key hierarchy**: a random 256-bit **master-KEK** is generated in the browser at vault setup. Per-file CEKs are wrapped against the master-KEK (AES-KW). The master-KEK itself is stored on the server only in *wrapped* form: a passphrase-wrapped copy (always) and an optional recovery-wrapped copy. Passphrase change re-wraps the master-KEK once; per-file envelopes are untouched. Recovery unwraps the same master-KEK via a different path. The master-KEK never leaves the browser unwrapped.
- **Passphrase UX**:
  - First entry: user navigates into `_secure/` (or creates it). A setup modal asks for a passphrase + a confirm field, shows a zxcvbn-style strength meter, and **blocks commit on score < 3**. The user must then **type "I understand" verbatim** in a confirmation field acknowledging "Lost passphrase = permanently lost data; no Kalepin operator, admin, or staff member can recover this." before the dialog will create the vault. Argon2id parameters: `memory=64MB, iter=3, parallelism=4` (auto-tuned per-device on first use). Salts are per-user, persisted unencrypted in the user record (`passphrase_salt`, `recovery_salt`).
  - Subsequent sessions: passphrase prompt on first `_secure/` access. Master-KEK cached as a non-extractable `CryptoKey` in IndexedDB, scoped to origin. Cleared on logout.
  - Multi-device: re-enter passphrase per browser. Same derivation path → same master-KEK unwrap.
- **Client crypto**:
  - `packages/frontend/src/crypto/envelope.ts`: identical wire format to stage 1's, with `KDF=Argon2id` and `wrapped_CEK` produced by AES-KW with the **master-KEK**. `kek_fingerprint = HMAC(master-KEK, "kalepin-kek-fp")[:8]` — stable across passphrase rotations.
  - `packages/frontend/src/crypto/key-store.ts`: IndexedDB-backed key handle (non-extractable, per-origin) for the unwrapped master-KEK.
  - `packages/frontend/src/crypto/argon2.ts`: WASM Argon2id (e.g., `argon2-browser`).
  - `packages/frontend/src/crypto/master-kek.ts`: setup / unlock / rotate-passphrase / generate-recovery flows over the wrapped-KEK blobs.
- **Server adapter changes**:
  - `EncryptingStorageAdapter` consults `kekSourceFor(path)`: returns `ClientKEKSource` for `_secure/` paths. `ClientKEKSource.read()` is a passthrough (returns ciphertext). `ClientKEKSource.write()` accepts ciphertext bytes verbatim (the client encrypted before upload).
  - The server never sees plaintext for `_secure/` paths.
- **Predicate flips**:
  - `isE2EEncrypted(path)`: returns true for `path.includes('/_secure/')` AND `path.startsWith('_users/{email}/')`.
  - `shouldIndexPlaintext(path)`: `!isE2EEncrypted(path)`.
  - `canCollab(path)`: `!isE2EEncrypted(path)`.
  - `commentBodiesEncrypted(path)`: `isE2EEncrypted(path)`.
  - `shareLinkMintable(path)`: `!isE2EEncrypted(path) && /* existing personal-folder gates */`.
- **Feature carve-outs for `_secure/` paths**:
  - **OT collaboration**: `doc:open` rejects with `e2e-no-collab` error. The frontend falls back to local-only edits with a banner explaining no concurrent editing.
  - **FTS / semantic / backlinks**: index nothing; queries skip these paths automatically.
  - **Comments**: `comments.controller` rejects path-keyed routes with 403 + `e2e-no-comments`. Future: client-side encrypted comments (deferred — requires comment-bodies-encrypted full implementation).
  - **Share-links**: mint rejected. Existing share-links from before the move are revoked when the note enters `_secure/` (see "Move semantics" below).
  - **MCP read tools**: return `{ kind: 'e2e-encrypted', path }` sentinel.
  - **Change-tracking**: `metadata_only` branch activates — stores hash + size + author + ts only.
  - **Public download-zip**: includes `_secure/` paths as raw envelope bytes (the user has the passphrase to decrypt locally) OR skips them with a manifest entry. Decision in design.md.
- **Move semantics** (the destructive operation):
  - **Plaintext → `_secure/`**: requires passphrase entry. Client decrypts the at-rest envelope (server unwraps with server KEK, sends CEK to client over TLS — the **last time** the server has access). Client wraps CEK with passphrase-derived KEK. Re-uploads. **All grants on the source path are revoked. PIN is cleared. Existing share-links on the path are deleted.** UI confirms: "Moving to _secure/ revokes 3 grants and 1 share-link. Continue?"
  - **`_secure/` → plaintext**: requires passphrase entry. Client unwraps CEK. Server re-wraps with server KEK. Plaintext is now server-readable again.
- **Sharing E2E notes — deferred**: granting on `_secure/` paths still rejected (consistent with stage 1's contract). A separate change `add-e2e-grant-sharing` (not in this proposal) would introduce per-user X25519 public keys and PKI-based CEK re-wrapping for grantees. Discussion captured in `design.md`.
- **Recovery codes — opt-in**: during passphrase setup, the user MAY generate a 24-word BIP-39 recovery phrase. A recovery-KEK is derived from the phrase via Argon2id (separate salt) and used to AES-KW-wrap the master-KEK; the wrapped blob is stored on the server as `user_meta.recovery_wrapped_kek`. The recovery phrase itself is NEVER transmitted to the server. Regenerating recovery codes (Settings → Security) replaces the wrapped blob.
- **Lost passphrase = permanently lost data** (without a recovery code). The setup dialog enforces this with a **typed-confirmation gate**: the user must type the literal string "I understand" before the dialog will accept the passphrase. A checkbox-only acknowledgement is explicitly insufficient.
- **Passphrase rotation**: Settings → Security → "Change passphrase". Requires the current passphrase (or the vault to already be unlocked). Derives a new passphrase-KEK, re-wraps the master-KEK, replaces `user_meta.passphrase_wrapped_kek`. Per-file envelopes untouched. After a successful **recovery-phrase unlock**, the user is *forced* through this flow before they can leave Settings — otherwise the forgotten passphrase remains the primary unlock and the recovery phrase becomes load-bearing.
- **Vault reset (escape hatch)**: Settings → Security → "Reset _secure/ vault". The honest answer for users who lost both passphrase and recovery phrase. Requires the user's existing logged-in session (no passphrase needed — that's the point). The dialog enumerates every file under `_secure/` that will be destroyed, requires the user to **type their own email address verbatim** to confirm, then triggers a server-side soft-delete: the entire `_users/{email}/_secure/` subtree is renamed to `_users/{email}/_secure.tombstone-{ts}/`, all `passphrase_wrapped_kek` / `recovery_wrapped_kek` / salts / vault-setup flag are cleared, and an email is sent to the user. A 24-hour grace period allows undo via an emailed link; after 24h a GC sweep unlinks the tombstone permanently. A `vault.reset` event is recorded in change-tracking (metadata only — paths + count + timestamp). The user can immediately set up a fresh vault with a new passphrase.
- **The leak sweep** (`packages/e2e/tests/e2e-secure-subfolder.spec.ts`): create a `_secure/` note as Alice with two unique tokens (path token + content token + attachment token + comment-attempt token). As Bob, perform every authenticated HTTP request and every MCP tool call, recursive-scan every response/event for any token. Zero matches required.

## Capabilities

### New Capabilities

- (none — extends `encryption` from stage 1)

### Modified Capabilities

- `encryption`: Adds the client-keyed envelope variant (`KDF=Argon2id`), `ClientKEKSource`, and the per-path KEK source selection.
- `full-text-search`: Skips indexing for `isE2EEncrypted` paths.
- `semantic-search`: Skips embeddings for `isE2EEncrypted` paths.
- `link-index`: Skips parsing for `isE2EEncrypted` paths.
- `change-tracking`: Activates the metadata-only branch wired in stage 1 for `isE2EEncrypted` paths.
- `comments`: Rejects path-keyed routes for `isE2EEncrypted` paths with 403.
- `share-links`: Mint rejected; existing links revoked on move-to-`_secure/`.
- `ot-collaboration`: `doc:open` rejected for `isE2EEncrypted` paths.
- `mcp-tool-registration`: Read tools return `e2e-encrypted` sentinel.
- `attachments`: Per-namespace `_attachments/` directories are E2E-encrypted under `_secure/`.
- `document-grants`: Granting on `isE2EEncrypted` paths still rejected (deferred to future change).

## Impact

- **Backend**: `ClientKEKSource` implementation; predicate flips; feature gates per design.
- **Frontend**: `crypto/` module; passphrase modal; lock indicator; OT-disabled banner; comments-disabled tooltip; recovery-codes flow.
- **Migration**: none. The feature is opt-in folder-by-folder. `_secure/` doesn't exist until the user creates it.
- **Risk**:
  - Lost passphrase → lost data. Mitigated by opt-in recovery codes, typed-confirmation gate at setup, and the vault-reset escape hatch for users who lost both.
  - User confusion about features-disabled. Mitigated by clear UI banners and a one-time onboarding tour for the first `_secure/` interaction.
  - Server-side bug surfacing plaintext. Mitigated by the leak-sweep test and contract-tests from stage 1's phase 12.
  - Multi-device passphrase-entry friction. Mitigated by clear "remember on this device" affordance (cached non-extractable master-KEK in IndexedDB).
  - Stolen session triggering vault reset. Mitigated by 24-hour soft-delete grace period + emailed undo link.
  - User unlocks via recovery phrase but never sets a new passphrase, leaving the recovery phrase as sole primary unlock. Mitigated by forced post-recovery passphrase rotation.
- **Performance**: Argon2id derivation runs once per session per device (~500ms-1s on modern hardware). All subsequent encrypt/decrypt is AES-GCM in WebCrypto, < 1ms per note.
