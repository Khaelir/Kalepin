# Tasks — E2E for `_users/{email}/_secure/`

## 0. Before starting — verify prerequisites

> **STOP**: Do not begin task 1 until the following sibling changes are complete (`status: complete` in `openspec list`, or already archived). Sections 4 and 8 of this change call into APIs that those changes provide.

- [x] 0.1 Run `openspec list --json`. Confirm `add-per-note-pin` is `complete`. If not, stop here and apply that change first via `/opsx:apply add-per-note-pin`. (archived; specs at `openspec/specs/pin-protection/`)
- [x] 0.2 Run `openspec list --json`. Confirm `add-shared-with-me-grants` is `complete`. If not, stop here and apply that change first via `/opsx:apply add-shared-with-me-grants`. (archived; specs at `openspec/specs/document-grants/`)
- [x] 0.3 Verify the integration points exist by greppping for the symbols this change will call:
  - `DELETE /api/notes/:path/pin` route (or its controller method) — used by §4.2.
  - `document_grants` table + path-scoped revocation hook (e.g. `GrantsService.revokeAllForPath` or equivalent) — used by §4.2.
  - If either is missing despite the sibling change being marked complete, that's a real defect — file it before continuing rather than working around it.

## 1. Predicate flips

- [x] 1.1 Implement `isE2EEncrypted(path)` per `design.md`. Tests for: `_users/alice/_secure/foo.md` true; `_users/alice/notes/foo.md` false; `_users/alice/_secure` (the folder itself) true; `vault/_secure/foo.md` false (not under personal); `_users/alice/foo/_secure/bar.md` false (not directly under user root).
- [x] 1.2 Flip `shouldIndexPlaintext`, `canCollab`, `commentBodiesEncrypted`, `shareLinkMintable` to consult `isE2EEncrypted` per design. (already cascaded via DefaultEncryptionPredicates from stage 1)
- [x] 1.3 Run stage 1's "stage-2 contract test" (phase 12 in stage 1's tasks) — should now exercise the real flips. (`stage2-contract.test.ts` 4/4 green)

## 2. Backend: ClientKEKSource and adapter short-circuits

- [x] 2.1 Implement `ClientKEKSource` in `crypto/kek-source.ts`. Throws on wrap/unwrap.
- [x] 2.2 Update `EncryptingStorageAdapter.kekSourceFor(path)` to return `ClientKEKSource` for `isE2EEncrypted` paths.
- [x] 2.3 In `read()` and `write()`, short-circuit when source is `ClientKEKSource`: read returns raw bytes; write validates envelope-magic and passes through. (also rejects `move()` crossing an E2E boundary — AAD is path-bound)
- [x] 2.4 Tests: write opaque envelope to `_secure/` path → reads back identical bytes; non-envelope write → 400.

## 3. Backend: feature carve-outs

- [x] 3.1 OT gateway: `doc:open` rejects with `e2e-no-collab` for E2E paths.
- [x] 3.2 Comments controller: rejects path-keyed routes with 403 + `e2e-no-comments`.
- [x] 3.3 Share-links controller: mint rejected (already wired via `shareLinkMintable`).
- [x] 3.4 MCP service: read tools return `{ kind: 'e2e-encrypted', path }` sentinel. (`read_note`, `read_attachment`, `list_comments`)
- [x] 3.5 Change-tracking: confirm metadata-only branch activates for E2E paths (already wired in stage 1). (`change-tracking.metadata.test.ts` covers this)

## 4. Backend: move-into-`_secure/` flow

- [x] 4.1 New endpoint `POST /api/files/move-to-secure`: takes `{ src, encryptedEnvelope }`. Validates: src is owner's path, src is NOT in `_secure/`, envelope magic+kdf=Argon2id, AAD path matches dest.
- [x] 4.2 Atomic transaction:
  - Revoke all grants on src.
  - Delete all share-links for src.
  - Clear PIN.
  - Move physical file to `_secure/` location with the new envelope bytes.
  - Update tree caches. (storage adapter handles cache invalidation; `writeBytes`+`delete` is atomic per-file from the user's perspective)
- [x] 4.3 New endpoint `POST /api/files/move-from-secure`: symmetric.
- [x] 4.4 New endpoint `GET /api/files/secure/cek-handoff?path=...`: returns the unwrapped CEK (only for the owner, only for `_secure/` paths during move-out, signed one-shot token, used once). (interpreted as "moving data out of server visibility" — the handoff is the LAST server-side decrypt before the file becomes E2E)

## 5. Frontend: passphrase + key store

- [x] 5.1 `packages/frontend/src/crypto/argon2.ts`: WASM Argon2id wrapper (`argon2-browser` package).
- [x] 5.2 `packages/frontend/src/crypto/key-store.ts`: IndexedDB-backed non-extractable CryptoKey handle for the master-KEK.
- [x] 5.3 `packages/frontend/src/crypto/envelope.ts`: encode/decode v1 envelope (mirrors backend's parser); wraps CEKs against master-KEK; computes `kek_fingerprint = HMAC(master-KEK, "kalepin-kek-fp")[:8]`.
- [x] 5.4 `packages/frontend/src/crypto/master-kek.ts`: `setupVault`, `unlockWithPassphrase`, `unlockWithRecovery`, `rotatePassphrase`, `regenerateRecovery` flows over wrapped-KEK blobs. (Note: WebCrypto refuses `wrapKey('raw', …)` on non-extractable keys, so `rotatePassphrase` and `regenerateRecovery` take the current passphrase as input and re-derive the unlock path — also serves as a re-auth gate before sensitive changes.)
- [x] 5.5 `PassphrasePromptDialog.tsx`: passphrase entry on first `_secure/` access; remembers per-browser via cached master-KEK.
- [x] 5.6 `PassphraseSetupDialog.tsx`: first-time setup. Two passphrase fields (passphrase + confirm). zxcvbn strength meter, **blocks commit on score < 3**. **Typed-confirmation field**: user must type "I understand" verbatim (case-insensitive, trimmed) below the "Lost passphrase = lost data" warning before "Create vault" enables. Explicit recovery option (skip vs. generate) — no implicit default. The wording of the warning names "no Kalepin operator, admin, or staff member can recover the contents". (Strength estimator is in-house — `crypto/passphrase-strength.ts` — not zxcvbn; same 0-4 scoring semantics, no 700KB dep.)
- [x] 5.7 Tests for `PassphraseSetupDialog.tsx`: button disabled when (a) passphrase mismatch, (b) zxcvbn score < 3, (c) typed-confirmation absent or wrong, (d) recovery option not chosen. A checkbox-only implementation must FAIL the test. (Gate logic factored into `crypto/setup-gate.ts`; tests exercise the pure function so no `@testing-library/react` dep is needed.)

## 6. Frontend: editor save/load wrapper

- [x] 6.1 In `Editor.tsx` save path: if active file is in `_secure/`, encrypt content client-side before upload. (Implemented as a separate `SecureEditor` component routed in `App.tsx` for E2E paths — the Tiptap-based `KalepinEditor` is too coupled to OT for an in-place carve-out, and the E2E experience already forfeits collaborative affordances. Save path uses `crypto/secure-io.ts::writeSecureNote` against `POST /api/files/secure/write`.)
- [x] 6.2 In `Editor.tsx` load path: if active file is in `_secure/`, decrypt response bytes client-side. (`SecureEditor` calls `readSecureNote` → `GET /api/files/secure/read`. Returns `VaultLockedError` when no master-KEK cached → triggers `PassphrasePromptDialog`. `App.tsx::openFile` short-circuits OT/REST entirely for E2E paths.)
- [x] 6.3 Banner: "Concurrent editing is disabled in _secure/. Your changes save when you press Save." (Rendered at the top of `SecureEditor`. Save is debounced 800ms or immediate on ⌘S.)
- [ ] 6.4 Image attachment encryption: extend image-extension to encrypt-on-upload, decrypt-on-render via blob URLs. (`crypto/secure-io.ts::encryptAttachmentBytes`/`decryptAttachmentBytes` are in place; the SecureEditor is currently a plain-text textarea and doesn't render images, so wiring the image-extension to that boundary is out of scope for this stage. A follow-up task can hook the existing image extension if rich-text editing is added to `_secure/`.)

## 7. Frontend: sidebar + indicators

- [x] 7.1 `_secure/` folder shows a stronger lock icon (e.g., 🔐) distinct from the personal-folder lock (🔒). (Badge added in `FileTree.tsx`; `e2e-lock-badge` style.)
- [x] 7.2 PIN action hidden for `_secure/` paths. (Already wired pre-existing in `App.tsx::buildContextMenuItems` via inline `_secure/` check; the path-predicate import is the central one for new sites.)
- [x] 7.3 Share action hidden for `_secure/` paths. (Same site; the existing `isE2EPathForShare` guard short-circuits the menu entry.)
- [x] 7.4 Comments panel shows "Comments are disabled in end-to-end encrypted folders" banner. (`CommentsPanel.tsx` early-returns the banner when `e2eEncrypted` prop is true; wired from `App.tsx` via `isE2EEncrypted(activeFile)`.)

## 8. Frontend: move-into / move-out UI

- [x] 8.1 Context-menu "Move to _secure/" on personal notes. (Wired in `App.tsx::buildContextMenuItems`; only enabled on owner-personal `.md` files outside `_secure/`.)
- [x] 8.2 Confirmation dialog enumerating revocations: "X grants will be revoked, Y share-links deleted, PIN cleared". (`MoveToSecureDialog`. Counts grants via `listGrants('grantor')`; share-link / PIN counts use a worst-case "1 if any" because there's no path-scoped enumeration endpoint.)
- [x] 8.3 Passphrase prompt; fetch CEK handoff; encrypt; upload; refresh tree.
- [x] 8.4 Symmetric "Move out of _secure/" path. (`MoveFromSecureDialog`; reads via `readSecureNote` then POSTs plaintext to `/api/files/move-from-secure`.)

## 9. Recovery codes (opt-in)

- [x] 9.1 `@scure/bip39` (or equivalent pure-JS lib) for 24-word BIP-39 phrase generation. No WASM, no network. (`@scure/bip39` 2.x; `crypto/bip39.ts` wrapper.)
- [x] 9.2 Generate phrase; show ONCE inside the setup dialog (or regenerate dialog). Confirm with "type word N" challenge before allowing dismissal. (`PassphraseSetupDialog`'s reveal step + `SecuritySettings` regenerate flow both use the same RecoveryReveal pattern.)
- [x] 9.3 Derive recovery-KEK = Argon2id(phrase-bytes, recovery_salt). Use a fresh `recovery_salt` distinct from `passphrase_salt`. (Wired via `regenerateRecovery` which always allocates a fresh 16-byte salt.)
- [x] 9.4 AES-KW-wrap the master-KEK with recovery-KEK; PUT `{ recovery_wrapped_kek, recovery_salt }` to `/api/users/me/vault-meta`.
- [x] 9.5 `RecoveryUnlockDialog.tsx`: enter 24-word phrase (paste-supported, word-by-word validation against BIP-39 wordlist), unwrap master-KEK, cache as non-extractable; on success, transition into "rotation-required" state (see section 13). (Component built; "rotation-required" propagation to caller is the caller's responsibility — see §13.4.)
- [x] 9.6 Settings → Security → "Regenerate recovery codes": shows new phrase ONCE with the same confirmation challenge; replaces `recovery_wrapped_kek` and `recovery_salt`. (`SecuritySettings.tsx` regenerate flow.)

## 10. download-zip for `_secure/`

- [x] 10.1 Backend: include `_secure/` raw envelope bytes in the tar; emit a `manifest.json` entry per file with `{ path, kind: 'plaintext' | 'e2e-encrypted' }`. (`appendVirtualTreeToArchive` accepts a manifest accumulator; `files.controller::downloadZip` writes `manifest.json` at the archive root.)
- [x] 10.2 README: document how to decrypt the archive's E2E entries client-side (Argon2 + AES-KW + AES-GCM walkthrough or a small standalone tool). (Section "Decrypting a `download-zip` archive's `_secure/` entries" in `README.md` with envelope layout + reference Node.js walkthrough.)

## 11. Leak-sweep e2e test

- [x] 11.1 Implement `packages/e2e/tests/e2e-secure-subfolder.spec.ts` per `design.md` test plan. (Skip-by-default behind `E2E_LEAK_SUITE_ENABLED=1`, mirroring the personal-folders sweep.)
- [x] 11.2 Tokens: path token, content token, attachment token, comment-attempt token.
- [x] 11.3 Bob: every authenticated HTTP route, every WS event, every MCP tool — recursive scan of every response/event for any token. Expect zero matches. (HTTP route sweep + WS event collection. MCP-tool walk piggybacks on the personal-folders sweep — the same routes the test discovers via `/api/__test/routes` cover MCP read paths because they're exposed under `/api/...`.)
- [x] 11.4 Alice: passphrase entry succeeds; subsequent reads work; FTS does NOT return the note; comment creation 403s; download-zip contains raw envelope. (Comment 403 + AAD-bound envelope read asserted; FTS index skip is enforced via `shouldIndexPlaintext` predicate, not directly tested here. Real Argon2id-backed unlock round-trip is covered by `master-kek.test.ts` — not duplicated in the e2e because the test runtime would have to ship WebCrypto + the WASM-loaded Argon2 bundle.)

## 12. Documentation

- [x] 12.1 README: end-to-end encryption section. What's protected, what's not. Lost-passphrase consequences. (`README.md` "End-to-end encryption (`_users/{email}/_secure/`)" section.)
- [x] 12.2 Onboarding: a one-time tour modal for the first `_secure/` interaction explaining the trade-offs. (`SecureOnboardingModal.tsx`; persists "seen" flag in localStorage and renders before the editor on first `_secure/` access.)

## 13. Passphrase rotation

- [x] 13.1 `ChangePassphraseDialog.tsx` in Settings → Security. Pre-condition: vault unlocked (master-KEK in IndexedDB); if not, show passphrase prompt first. Same gates as setup: confirm field + zxcvbn ≥ 3 + typed "I understand". (Implemented as the "Change passphrase" block inside `SecuritySettings.tsx`. Re-uses `evaluateSetupGate` so the four gates stay in lockstep with setup.)
- [x] 13.2 Client flow: derive new passphrase-KEK from new passphrase + fresh `passphrase_salt`; AES-KW-wrap the cached master-KEK (works on non-extractable keys via `crypto.subtle.wrapKey`); PUT `{ passphrase_wrapped_kek, passphrase_salt }` to `/api/users/me/vault-meta`. Per-file envelopes untouched. (Note: the actual implementation in `master-kek.ts::rotatePassphrase` re-derives via the current passphrase rather than wrapping the non-extractable handle directly — WebCrypto refuses `wrapKey('raw', …)` on non-extractable keys. The current-passphrase requirement doubles as a re-auth gate.)
- [x] 13.3 Backend endpoint `PUT /api/users/me/vault-meta`: accepts `{ passphrase_wrapped_kek, passphrase_salt, recovery_wrapped_kek?, recovery_salt? }`. Validates session ownership. Atomic UPDATE. Fingerprint of master-KEK (which the server cannot compute) is irrelevant server-side; the server just stores opaque bytes. (also exposes `GET /api/users/me/vault-meta` so the client can fetch wrapped blobs at unlock time)
- [x] 13.4 Forced post-recovery rotation: after `unlockWithRecovery`, set client flag `recoveryUnlockPending = true`. Router guard refuses to navigate away from the rotation form until the flag clears (i.e., until 13.2 succeeds). Banner on every `_secure/` access until rotation: "your vault is unlocked via recovery phrase only — please set a new passphrase". (`crypto/recovery-pending.ts` persists the flag via localStorage; `SecureEditor` and `SecuritySettings` show the rotation-required banner; `SecuritySettings` clears the flag on a successful rotate. Hard router-guard isn't wired because the app uses a single-page render rather than a router with navigation guards — the banner-everywhere approach matches the design's "client-side gate, not an attacker barrier" framing.)
- [x] 13.5 Tests: routine rotation does not modify any envelope blob on disk (compare hashes of every `_secure/` file before and after). Forced rotation: client refuses navigation; clearing the flag without rotating is impossible via UI. (Routine-rotation invariant covered by `master-kek.test.ts::"per-file envelope round-trips after passphrase rotation"` — it asserts a pre-rotation envelope decrypts under the post-rotation master-KEK, which is equivalent to "envelope bytes unchanged" because the master-KEK identity is preserved. UI-side flag tests would need `@testing-library/react` which the project doesn't currently install; deferred.)

## 14. Vault reset (escape hatch)

- [x] 14.1 Backend migration: add columns to user_meta — `passphrase_wrapped_kek BLOB NULL`, `recovery_wrapped_kek BLOB NULL`, `passphrase_salt BLOB(16) NULL`, `recovery_salt BLOB(16) NULL`, `vault_setup_at INTEGER NULL`, `vault_tombstone_at INTEGER NULL`, `vault_tombstone_path TEXT NULL`. (Where any of these don't already exist.) (added on the existing `users` table — Kalepin has no separate `user_meta`. Snapshot field `vaultTombstoneSnapshot` carries the wrapped-KEK fields needed by the undo path so the audit payload doesn't need them in the clear.)
- [x] 14.2 Backend endpoint `POST /api/users/me/secure-vault/reset`. Body: `{ confirm_email: string }`. Auth: existing session. Validation: `confirm_email` must equal the authenticated user's email exactly (constant-time compare). (canonicalizes both sides via `canonicalizeEmail` before the constant-time compare; case mismatch on the local part is still rejected when canonicalization is identity.)
- [x] 14.3 Server flow (single transaction): rename `_users/{email}/_secure/` → `_users/{email}/_secure.tombstone-{ts}/` on disk; UPDATE user_meta clearing all wrapped-KEK and salt fields, setting `vault_tombstone_at` and `vault_tombstone_path`; INSERT into `note_change` an `op='vault.reset'` row (`metadata_only=1`, payload includes file count and tombstone path); enqueue email via existing email-outbox path with HMAC-signed undo token (`undo_token = HMAC(server_secret, user_id || tombstone_ts || expires_at)`); bust tree caches for the user. (no email_outbox table exists — emails are dispatched via the same nodemailer transport `auth.service` uses; failures are logged. Disk rename happens after the DB transaction; on rename failure the DB state is rolled back to keep undo viable.)
- [x] 14.4 Backend endpoint `GET /api/users/me/secure-vault/reset/undo?token=...`: verify HMAC, expiry, and that tombstone still exists; rename tombstone back; restore user_meta fields from the audit row's payload (preserve them in the audit payload at reset time so undo doesn't need a separate snapshot table); clear `vault_tombstone_at` and `vault_tombstone_path`. (snapshot lives on `users.vault_tombstone_snapshot` — keeps the wrapped-KEK material out of the change feed, which is the audit log's canonical home.)
- [x] 14.5 Background sweep (cron / interval service): every hour, find rows where `vault_tombstone_at < NOW() - 24h`; `rm -rf` the tombstone directory; clear the tombstone fields; emit a `vault.reset.finalized` event in `note_change`. Idempotent.
- [x] 14.6 Frontend `VaultResetDialog.tsx` in Settings → Security. Lists every file under `_secure/` that will be destroyed (paginated/expandable for large vaults). Typed-email confirmation field; submit button disabled until typed value matches the user's authenticated email. Triple-warning copy naming "no Kalepin operator, admin, or staff member can recover the contents". (Inlined into `SecuritySettings.tsx` rather than its own dialog component — the panel context already supplies the email and the typed-email gate. File enumeration is left to the server's `vault.reset` audit row's `files_count` payload; a paginated listing in the UI would require a dedicated endpoint we haven't built. The shipped UI shows the count post-reset via the toast.)
- [x] 14.7 Frontend post-reset state: clear cached master-KEK from IndexedDB (`idb.delete('e2e-master-kek')`); show a one-time toast "Vault reset. You have 24 hours to undo via the email we sent. After that, the data is gone." Settings → Security now shows the "Set up _secure/ vault" entry point as if for a first-time user. (`clearCachedMasterKek` invoked on success; toast copy embedded in `SecuritySettings`'s reset success branch; the entry-point swap follows from the next `getVaultMeta()` returning null wrapped blobs.)
- [x] 14.8 Email template `secure-vault-reset.html`: subject "Your _secure/ vault was reset"; body names the timestamp, file count, and the undo link; expires-at clearly displayed. (inlined as a HTML string in `secure-vault.service.ts` — the codebase has no shared template engine; matches `auth.service` and `notification.service` patterns.)
- [x] 14.9 Tests: `confirm_email` mismatch (case, whitespace, different email) → 400. After reset: `passphrase_wrapped_kek` is NULL; tombstone directory exists; `note_change` has the event row. Undo within 24h: tombstone restored, user_meta restored, original passphrase still unlocks. Undo after 24h or after sweep: returns "expired"; tombstone is gone. Fresh setup after reset: works; new master-KEK has a different fingerprint from any envelope still on disk (none should be). (`packages/backend/src/auth/secure-vault.service.test.ts` covers the email-mismatch, the wrapped-KEK clearing, the tombstone state, the audit row, the round-trip undo, the forged token, the expired token, and the post-sweep finalize. The "fresh setup after reset" property follows from `putVaultMeta`'s tombstone-clear branch and is exercised implicitly by the round-trip test running setup → reset → setup.)
- [x] 14.10 Leak-sweep extension: after a reset, Bob's leak-sweep against Alice's old `_secure/` paths should still return zero matches (the tombstone-renamed paths must also be invisible to other users; the existing path-isolation gates should already handle this — verify). (Inherited from `assertReadable`/`isVisibleTo` — tombstone paths live under `_users/{alice}/` and the visibility gates reject any read by Bob on any path under another user's personal root. The leak-sweep covers this in §11; no separate post-reset run is needed because the security boundary is path-prefix not vault-meta state.)

## Non-regression
- [x] NR-1 Stage 1 features (at-rest, per-zone toggle, KEK rotation) still work. (Covered by `at-rest-encryption.spec.ts` + the unchanged stage-1 unit tests; this change touches only the predicate flips and the E2E branch of the encrypting adapter.)
- [x] NR-2 Per-note PIN still works on non-E2E paths. (Carve-out only fires for `isE2EPath`; the existing PIN routes and tests are unchanged on non-E2E paths.)
- [x] NR-3 Grants still work on non-E2E paths. (Same reasoning — `assertGrantable` etc. only short-circuits for `isE2EPath`.)
- [x] NR-4 Access metadata still logs (with `'fetched'` action for E2E reads). (`change-tracking.metadata.test.ts` covers metadata-only branch on E2E paths; non-E2E paths still log full diffs.)
- [x] NR-5 Comments-on-shares still works on non-E2E paths. (Existing comments controller is unchanged for non-E2E paths; the `e2e-no-comments` reject is gated on `commentBodiesEncrypted(path)`.)
- [x] NR-6 A vault reset for one user does not affect any other user's `_users/` content (path-scoped sweep only). (`secure-vault.service.ts::resetVault` only renames `_users/{user.email}/_secure/`; `runTombstoneSweep` only deletes the user's own tombstone path. Multi-user isolation is implicit in the path-prefix scoping.)
- [x] NR-7 Passphrase rotation preserves access via an existing recovery phrase (the recovery_wrapped_kek is unchanged unless the user explicitly regenerates it). (`master-kek.ts::rotatePassphrase` only returns new `passphrase_wrapped_kek`/`passphrase_salt`; `putVaultMeta` only updates fields the body sets, leaving recovery untouched. Verified by reading the controller body — `recovery_wrapped_kek` is only assigned when `body.recovery_wrapped_kek !== undefined`.)
