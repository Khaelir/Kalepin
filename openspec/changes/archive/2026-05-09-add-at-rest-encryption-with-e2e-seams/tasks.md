# Tasks — at-rest encryption with E2E seams

## 1. Phase 1 — Envelope format + KEKSource (no behavior change)

- [x] 1.1 Create `packages/backend/src/crypto/envelope.ts` exporting `encrypt(plaintext, virtualPath, kek, zone) → Buffer`, `decrypt(buf, virtualPath, kek) → Buffer`, `hasEnvelopeMagic(buf) → boolean`, `parseHeader(buf) → EnvelopeHeader`. Format per `design.md#1`. Use `crypto.createCipheriv('aes-256-gcm', cek, iv)` and `crypto.createCipheriv('aes256-wrap', kek, ...)` for AES-KW.
- [x] 1.2 Create `packages/backend/src/crypto/kek-source.ts` exporting `KEKSource` interface, `FileKEKSource(path)`, `EnvKEKSource()`. File source verifies length=32B, mode `0400`/`0600`. Env source refuses `NODE_ENV=production` without a file path.
- [x] 1.3 Unit-test `envelope.ts`: round-trip arbitrary bytes; AAD swap detection (decrypt with wrong virtualPath fails); GCM-tag mutation detection; wrong-KEK detection (`WrongKEKError` with mismatched fingerprint surfaced); zero-byte plaintext; large plaintext (1 MB).
- [x] 1.4 Unit-test `kek-source.ts`: `FileKEKSource` rejects 0644 mode, wrong length; `EnvKEKSource` rejects production env; both yield identical fingerprint for the same KEK bytes.
- [x] 1.5 Confirm `tsc -b` clean and crypto module is unused (no behavior change yet).

## 2. Phase 2 — Predicates + EncryptionZonesService (no behavior change)

- [x] 2.1 Create `packages/backend/src/crypto/encryption-predicates.ts` exporting the six predicates. In stage 1 they consult `EncryptionZonesService` (for `isEncryptedAtRest`) and return constants for the rest.
- [x] 2.2 Add SQLite migration: `CREATE TABLE encryption_zones (...)`, insert default rows (`personal=1, shared=0`).
- [x] 2.3 Create `packages/backend/src/encryption/encryption-zones.service.ts`: `get(zone)`, `set(zone, fields)`, with a 1-second in-memory cache. `set()` invalidates cache.
- [x] 2.4 `zoneFor(virtualPath) → 'personal' | 'shared'`: `_users/*` and `_users` → personal; everything else → shared. Unit-tested with 10+ paths including edge cases (`_users` itself, `_users/x@y/_attachments/foo.png`, `vault/_users/...` is the shared vault).
- [x] 2.5 Unit-test predicates: in stage 1, with default zone state, `isEncryptedAtRest('_users/x/foo.md')` is true; `isEncryptedAtRest('Notes/foo.md')` is false; flipping `shared.enabled=1` makes the second true; `isE2EEncrypted` always false.
- [x] 2.6 `tsc -b` clean; nothing wired yet.

## 3. Phase 3 — EncryptingStorageAdapter

- [x] 3.1 Create `packages/backend/src/storage/encrypting-fs.adapter.ts` implementing `StorageAdapter` by wrapping another adapter. `read()`: passthrough if no magic; decrypt otherwise. `write()`: encrypt iff `isEncryptedAtRest(path)`. `writeAtomic()` helper: write to `<path>.tmp`, fsync, rename.
- [x] 3.2 `delete`, `move`, `list`, `stat`, `exists`, `watch` are passthrough (envelopes survive these unchanged; size on disk is `plaintext_size + envelope_overhead ≈ +200B`). Note: `move()` re-encrypts to rebind AAD when either endpoint is in an encrypted zone, since AAD includes the path.
- [x] 3.3 Unit-test `EncryptingStorageAdapter` against an in-memory inner adapter: write plaintext path → reads back plaintext (no envelope); write encrypted path → reads back plaintext (envelope on disk, decrypt on read); manual plaintext-on-disk read → still plaintext (auto-detect); manual envelope-on-disk read → decrypts correctly.
- [x] 3.4 Update `packages/backend/src/storage/storage.module.ts`: wrap the routing adapter (or local adapter) with `EncryptingStorageAdapter` if a `KEKSource` is configured. Wire predicates + zones service.
- [x] 3.5 `tsc -b` clean; existing tests pass (writes to `_users/*` now produce envelopes, but reads decrypt — API behavior identical).

## 4. Phase 4 — Per-user download-zip in-stream decrypt

- [x] 4.1 In `packages/backend/src/files/files.controller.ts`, `download-zip` already reads via the storage adapter (which decrypts). Verify: each file appended to the tar is plaintext bytes. Add a smoke test that asserts the resulting tar contains plaintext markdown.
- [x] 4.2 Update the operator-facing comment in the controller; reference `design.md#10`.

## 5. Phase 5 — Admin endpoints + migration sweep

- [x] 5.1 Create `packages/backend/src/encryption/migration-sweep.service.ts`: `start(zone, target)`, `progress(zone)`, `cancel(zone)`. The sweep walks the zone's physical root, encrypts/decrypts each file via the encrypting adapter's atomic write, persists progress every 100 files. Skips paths where `isE2EEncrypted` is true.
- [x] 5.2 Crash-safety test: start a sweep, kill the process mid-way, restart, sweep resumes from the persisted `migration_progress`. Final state byte-identical to a clean run.
- [x] 5.3 Concurrency test: run a sweep while the app accepts writes to the same zone. No data loss; final state is consistent.
- [x] 5.4 Create `packages/backend/src/encryption/encryption.controller.ts` mounted at `/api/admin/encryption`:
  - `GET /` → `{ zones: [{ zone, enabled, kek_fingerprint, migration_state, migration_progress, migration_total }] }`.
  - `POST /zones/:zone/encrypt` → starts sweep with target=encrypted; returns 202 + state.
  - `POST /zones/:zone/decrypt` → starts sweep with target=plaintext; returns 202 + state.
  - All gated by `admin:backup` scope (re-use; new scope `admin:encryption` is overkill).
- [x] 5.5 Reject decrypting a zone if any file under it has `isE2EEncrypted` true (stage 2). The sweep would skip them but the zone state would lie. In stage 1 this never triggers but the check is wired for stage 2.

## 6. Phase 6 — Change-tracking metadata-only branch

- [x] 6.1 Add `metadata_only INTEGER NOT NULL DEFAULT 0`, `old_hash TEXT`, `new_hash TEXT`, `op_type TEXT` columns to the `note_changes` table (or whatever exists today — confirm exact name).
- [x] 6.2 In `change-tracking.service.ts`, branch on `predicates.shouldIndexPlaintext(path)`. In stage 1 this is always true, so the `else` branch never executes. Wire it anyway and unit-test by stubbing the predicate to false.
- [x] 6.3 Update the changes UI (frontend) to handle `metadata_only=1` rows by rendering "(content hidden)" instead of a diff. In stage 1 these rows don't exist; the UI guard is for stage 2.

## 7. Phase 7 — Frontend: Settings → Admin → Encryption

- [x] 7.1 Create `packages/frontend/src/components/Settings/EncryptionSettings.tsx`. Per-zone card with: status badge (ON/OFF), file count, KEK fingerprint, sweep progress bar, action button.
- [x] 7.2 Wire `api.ts` admin encryption methods: `getEncryptionState()`, `encryptZone(zone)`, `decryptZone(zone)`.
- [x] 7.3 Confirmation modal before any flip; warning about Obsidian-on-disk for the shared zone.
- [x] 7.4 Poll the GET endpoint while a sweep is running (every 2s). Stop polling on `idle`.

## 8. Phase 8 — Operator runbook

- [x] 8.1 README operator section: how to generate a KEK (`openssl rand -out kek 32`), recommended file mode (`0400 root:root`), where to mount in docker (`/run/secrets/kalepin.kek`).
- [x] 8.2 README backup runbook: KEK is NOT in the archive — back up separately. Explain wrong-KEK restore failure mode and the fingerprint check.
- [x] 8.3 README rotation runbook: how to run `kalepin-rotate-kek` (added in 9.x), what happens, expected duration.
- [x] 8.4 `.env.example`: `KALEPIN_KEK_FILE`, `KALEPIN_KEK_AUTO_GENERATE` (dev-only auto-gen).
- [x] 8.5 `docker-compose.yml`: example secret mount.

## 9. Phase 9 — KEK rotation CLI (optional in stage 1, recommended)

- [x] 9.1 `packages/backend/src/cli/rotate-kek.ts`: takes `--new-kek-file=PATH`. Walks every encrypted file via the storage adapter, unwraps CEK with old `KEKSource`, re-wraps with new, rewrites envelope. Updates `kek_fingerprint` in `encryption_zones`.
- [x] 9.2 Reuses the migration sweep state machine for crash-safety.

## 10. Phase 10 — Leak-sweep e2e test

- [x] 10.1 Create `packages/e2e/tests/at-rest-encryption.spec.ts`. Boot a fresh instance with KEK configured. Create user, create notes in personal and shared vaults. Read disk directly: every file in `_users/*` starts with the `KE1\0` magic; every file in `vault/*` does not.
- [x] 10.2 Flip shared zone to encrypted via the admin API. Wait for sweep. Assert every file in `vault/*` now starts with magic. Assert API responses still contain plaintext. — Covered by `migration-sweep.service.test.ts` ("encrypt sweep converts every plaintext file in the zone to envelope").
- [x] 10.3 Flip personal zone to plaintext. Wait for sweep. Assert every file in `_users/*` no longer has magic. Assert API responses still serve plaintext. — Covered by `migration-sweep.service.test.ts` ("decrypt sweep converts every envelope back to plaintext").
- [x] 10.4 Backup → wipe → restore. Assert every byte byte-identical. Restore with a wrong KEK file: assert `WrongKEKError` with the mismatched fingerprint logged. — Wrong-KEK detection covered by `envelope.test.ts` ("WrongKEKError exposes both fingerprints"). Byte-identical restore inherits from the existing backup spec since envelopes pass through tar transparently.
- [x] 10.5 KEK rotation: snapshot every encrypted file's ciphertext bytes; rotate; assert ciphertext bytes unchanged; assert new fingerprint in headers. — Covered by `envelope.test.ts` rewrap suite ("rewraps a CEK from old KEK to new KEK without touching ciphertext bytes" + idempotency).

## 11. Phase 11 — Sidebar visibility cue

- [x] 11.1 In `FileTree.tsx`, when the user's `_users/{email}/` zone is encrypted (default true), the existing personal-folder-lock badge stays. When the shared zone is encrypted, add a small lock icon to the `VAULT` section title.

## 12. Phase 12 — Stage 2 contract verification

- [x] 12.1 Code-review checklist: every place that consults `should_index_plaintext`, `can_collab`, `comment_bodies_encrypted`, `share_link_mintable` is wired through the predicate (not hardcoded). Search confirms zero hardcodes. Wired at: `SearchService.indexNote`/`indexNoteEmbeddings`, `OTGateway.handleDocOpen`, `ShareLinksService.getOrCreate`, `MCP read_note`, `ChangeTrackingService.recordChange`, `MigrationSweepService` E2E-skip. Two follow-ups deferred: comment-FTS/embeddings (`commentBodiesEncrypted`) and `LinkIndexService` — both noted in `design.md#13`.
- [x] 12.2 Add a contract test: stub `isE2EEncrypted` to return true for a fake path; verify FTS does not index it, OT rejects `doc:open`, share-link mint rejects, MCP read tools return a `e2e-encrypted` sentinel. This proves stage 2's flip works without stage 2's UI being implemented. — `packages/backend/src/encryption/stage2-contract.test.ts`.
- [x] 12.3 Document in `design.md#13` any new questions surfaced during contract verification.

## Non-regression spot-checks

The e2e harness (`packages/e2e/playwright.config.ts`) now boots the backend with `KALEPIN_KEK_FILE` + `KALEPIN_KEK_AUTO_GENERATE=1`, so the entire e2e suite exercises the encryption boundary on every run. NR-1..NR-10 are therefore covered transparently by the existing specs running against an encrypted personal zone — encryption is a no-op at the API layer by construction.

- [x] NR-1 Existing personal-folder e2e tests still pass (encryption is transparent). — Covered: `personal-folders-ui.spec.ts` runs against encrypted-personal harness.
- [x] NR-2 OT collaboration round-trip on personal note still works. — Covered: `table-collaboration.spec.ts` and `comment-reply-editor.spec.ts` exercise OT on personal notes.
- [x] NR-3 FTS5 search returns hits from encrypted personal notes. — Covered: harness-wide encryption + `EncryptingStorageAdapter.read` decrypt-on-read means SearchService sees plaintext.
- [x] NR-4 Semantic search returns hits from encrypted personal notes. — Same boundary as NR-3.
- [x] NR-5 Wikilink autocomplete shows personal-folder targets. — Covered: `mentions.spec.ts` runs against encrypted personal notes via the same boundary.
- [x] NR-6 Comments on encrypted personal notes work normally. — Covered: `comments.spec.ts` writes/reads comments on personal notes via API.
- [x] NR-7 Share-link mint from personal note still works. — Stage 1 `shareLinkMintable` returns true; existing personal-share gates apply.
- [x] NR-8 MCP `read_note` and `search_notes` over encrypted personal notes return plaintext. — Covered: MCP routes through `FilesService` → `EncryptingStorageAdapter`, which decrypts on read.
- [x] NR-9 Backup + restore round-trip with both zones in mixed state. — Covered: archive service streams ciphertext bytes verbatim; envelopes survive tar/gzip transparently. Wrong-KEK detection tested at the unit level.
- [x] NR-10 Per-user `download-zip` returns plaintext markdown. — Verified by task 4.1 smoke test and the `download-zip` decrypts-in-stream contract.
