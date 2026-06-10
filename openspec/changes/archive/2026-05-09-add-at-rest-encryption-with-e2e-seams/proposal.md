# Add at-rest encryption with per-zone admin toggle and E2E seams

## Why

Today, every byte under `VAULT_PATH` and `PERSONAL_PATH` is plaintext markdown on disk. A leaked S3 backup, a stolen disk image, a misconfigured tar.gz, or an inadvertently public bucket exposes every note. Disk-level encryption only protects an unmounted device — it does nothing for a backup that's been copied off-host. We need encryption that travels with the *files*.

The same architecture is tugging in two directions. Most users want **"my journal is unreadable if my Hetzner box is compromised or my S3 backup leaks"** — the cheap, no-feature-loss path. A subset want **"not even I, the admin, can read this, ever"** — the feature-poor, E2E path. These are two stages of the same architecture: envelope encryption with the keyholder swapped. Stage 1 (server-keyed) leaves every feature intact; stage 2 (client-keyed for `_users/{email}/_secure/`) trades features for true E2E.

A third tension: deployments are heterogeneous. Some run a single-tenant Hetzner box with one user — the shared vault has no real "shared" semantics, just convenience. Others run a multi-user shared workspace where Obsidian-on-disk compatibility matters. **The encryption choice should not be ours to mandate per zone.** Admins should toggle each zone, on the fly, with a sensible default.

This proposal ships **stage 1 with a per-zone admin toggle and the seams stage 2 needs already in place**. Stage 2 ships in a separate change (`add-e2e-secure-subfolder`) after stage 1 has soaked. The +1.5-day cost of "future-proofing" stage 1 saves ~1 week of stage-2 work and — more importantly — guarantees we don't have to re-encrypt the whole vault when stage 2 lands.

## What Changes

- **Per-zone admin toggle (default: personal ON, shared OFF).** Two zones, independently switchable:
  - `personal` zone — `_users/*` and `personal/.../_attachments/*`. Default: **encrypted**.
  - `shared` zone — `vault/*` and `vault/_attachments/*`. Default: **plaintext**.
  Admin endpoints `POST /api/admin/encryption/zones/{zone}/encrypt` and `POST /api/admin/encryption/zones/{zone}/decrypt` start a backgrounded sweep that migrates files in place. The current state is exposed at `GET /api/admin/encryption`. UI lives under Settings → Admin → Encryption with per-zone status, file counts, and migration progress.
- **Envelope encryption (per-note CEK wrapped by a server KEK).** Each note gets a fresh 256-bit Content Encryption Key (CEK), random per write. The CEK is wrapped with the KEK and stored in the file header. Bulk content uses AES-256-GCM with a per-write random IV and the path bound in as AAD. KEK rotation re-wraps the small CEK; ciphertext bytes do not move.
- **Self-describing envelope format v1.** Header: `magic ("KE1\0", 4B) | version (u8) | algorithm (u8) | KDF (u8) | KDF_params_len (u16) | KDF_params | IV (12B) | wrapped_CEK_len (u16) | wrapped_CEK | KEK_fingerprint (8B) | AAD_len (u16) | AAD | ciphertext | auth_tag (16B)`. AAD includes virtual path, file kind, format version. Stage 2 uses the same header with `KDF=Argon2id` and a different `wrapped_CEK` source.
- **Encryption boundary at the StorageAdapter, not the FilesService.** A new `EncryptingStorageAdapter` wraps the existing `RoutingStorageAdapter`. `read()` decrypts; `write()` encrypts iff `isEncryptedAtRest(path)` is true at write time. `FilesService`, OT, FTS, semantic search, link index, comments, share-links, MCP, and change tracking all see plaintext — they're unchanged.
- **Auto-detection on read.** `EncryptingStorageAdapter.read()` checks the first 4 bytes for the `KE1\0` magic. If present, it's an envelope — decrypt. If absent, it's plaintext — pass through. This is what lets the runtime toggle work: during a sweep, files are mid-state, and reads must handle either form transparently.
- **Per-zone state in DB.** New table `encryption_zones (zone, enabled, kek_fingerprint, migration_state, migration_progress, migration_total, updated_at)`. Source of truth for the predicate and the sweep state machine.
- **KEK source: file-based.** A `KEKSource` interface with a `FileKEKSource` implementation that reads 32 bytes from `KALEPIN_KEK_FILE` (default `/run/secrets/kalepin.kek`, must be `0400` or stricter). Env-var fallback (`KALEPIN_KEK`) for dev only — refused if `NODE_ENV=production` and no file path is set. Auto-generates the KEK on first boot if the file is missing and `KALEPIN_KEK_AUTO_GENERATE=1`. Interface stays open for `KMSKEKSource` and `ClientKEKSource` (stage 2) later.
- **Predicate hooks (the seams).** Six new predicates ship in stage 1, ready for stage 2 to flip:
  - `isEncryptedAtRest(path)` — consults `encryption_zones` table; in stage 1 default returns true under `_users/*`, false elsewhere.
  - `isE2EEncrypted(path)` — false everywhere in stage 1; stage 2 makes it true under `_users/{email}/_secure/`.
  - `should_index_plaintext(path)` — true everywhere in stage 1.
  - `can_collab(path)` — true everywhere in stage 1.
  - `comment_bodies_encrypted(path)` — false everywhere in stage 1.
  - `share_link_mintable(path)` — true everywhere in stage 1 (existing personal-folder gates still apply).
- **Change-tracking metadata-only mode.** `change-tracking` today stores raw diffs. Stage 1 introduces a metadata-only mode (`hash | size | author | ts | op_type`) gated by `should_index_plaintext(path)`. In stage 1 it's wired up but never activates (predicate is true everywhere). Stage 2 flips it for `_secure/`.
- **Per-user download zip.** Stage 1 must decrypt the user's own subset before zipping (otherwise the user gets ciphertext they can't use without a KEK they shouldn't have). The handler decrypts in-stream as it walks the archive entries.
- **Migration sweep (the fly-able operation).** A `MigrationSweepService` walks a zone's physical root, encrypts (or decrypts) every file in place via write-tmp + `fsync` + atomic rename, updates `migration_progress` after every batch, and is resumable on crash. Concurrent reads/writes during the sweep are safe because of envelope auto-detection. Skips paths where `isE2EEncrypted(path)` is true (stage 2 owns those).
- **Backup / restore.** `archiveService.createArchive()` already symlinks both roots; ciphertext travels through transparently. Restore is byte-identical on ciphertext. **The KEK is NOT included in the archive.** README operator runbook documents that the KEK must be backed up separately. The KEK fingerprint is included in every envelope so a wrong-KEK restore fails fast with the actual mismatch surfaced.
- **Tests.** A leak-sweep test (`packages/e2e/tests/at-rest-encryption.spec.ts`) confirms: every file in a zone marked `enabled=1` is an envelope; restoring with a different KEK fails with a clear error; rotating the KEK re-wraps every CEK and leaves ciphertext bytes untouched; the API still serves plaintext for every existing endpoint; flipping a zone from plaintext to encrypted (and back) leaves every file's plaintext content byte-identical.

## Capabilities

### New Capabilities

- `encryption`: At-rest envelope encryption with a per-zone admin toggle, predicate-driven seams, on-the-fly migration sweep, and a versioned envelope format that stage 2 extends to client-keyed E2E.

### Modified Capabilities

- `storage-adapters`: New `EncryptingStorageAdapter` wraps the existing `RoutingStorageAdapter`. Disk holds envelopes for any zone marked encrypted; the FilesService boundary still sees plaintext markdown.
- `file-management`: `download-zip` decrypts in-stream. Per-user zip is plaintext. Otherwise unchanged.
- `full-text-search`: SearchService runs through the (decrypted) read path, so FTS5 still indexes plaintext. The `should_index_plaintext` predicate is consulted at index time but is true everywhere in stage 1.
- `semantic-search`: Same — embeddings index decrypted plaintext.
- `link-index`: Parses decrypted markdown for `[[wikilinks]]`. Predicate consulted at parse time.
- `change-tracking`: New metadata-only diff mode wired up but inert in stage 1.
- `admin-backup-download`: Documented operator KEK-custody runbook; archive is ciphertext-on-disk plus DB.
- `attachments`: Attachment blobs encrypted with the same envelope format under encrypted zones.

## Impact

- **Affected code (backend)**:
  - `packages/backend/src/crypto/envelope.ts` (new) — encode/decode v1 envelope format.
  - `packages/backend/src/crypto/kek-source.ts` (new) — `KEKSource` interface, `FileKEKSource`, `EnvKEKSource` (dev-only).
  - `packages/backend/src/crypto/encryption-predicates.ts` (new) — six seam predicates.
  - `packages/backend/src/encryption/encryption-zones.service.ts` (new) — DB-backed state for the zones table + cache.
  - `packages/backend/src/encryption/migration-sweep.service.ts` (new) — backgrounded encrypt/decrypt sweep.
  - `packages/backend/src/encryption/encryption.controller.ts` (new) — admin endpoints (`GET`, `POST encrypt`, `POST decrypt`).
  - `packages/backend/src/storage/encrypting-fs.adapter.ts` (new) — wraps any `StorageAdapter`.
  - `packages/backend/src/storage/storage.module.ts` — wrap the routing adapter in `EncryptingStorageAdapter` when KEK is configured.
  - `packages/backend/src/files/files.controller.ts` — `download-zip` decrypts in-stream.
  - `packages/backend/src/changes/change-tracking.service.ts` — metadata-only mode, gated by predicate.
  - `packages/backend/src/archive/archive.service.ts` — no behavior change but documentation note about KEK custody.
- **Affected code (frontend)**:
  - `packages/frontend/src/components/Settings/EncryptionSettings.tsx` (new) — per-zone toggle UI with progress bar.
  - `packages/frontend/src/api.ts` — admin encryption endpoints.
- **Affected code (config / ops)**:
  - `.env.example` — `KALEPIN_KEK_FILE`, `KALEPIN_KEK_AUTO_GENERATE`.
  - `docker-compose.yml` — example secret mount.
  - `README.md` — operator runbook: generating, backing up, rotating the KEK; how the per-zone toggle works.
- **Migrations**:
  - DB: `encryption_zones` table + initial row inserts (`personal` enabled, `shared` disabled).
  - Files: no eager sweep on first boot. New writes encrypt according to the predicate; old plaintext personal files stay readable until the admin runs a sweep (via the API or an explicit CLI). The env auto-runs a one-shot sweep iff `KALEPIN_INITIAL_PERSONAL_SWEEP=1` is set.
- **Performance**: AES-GCM at AES-NI speeds is ~5 GB/s on modern x86. Per-read overhead for a 100KB note is < 100 µs. The sweep operates at disk-bound speeds (10s of MB/s on typical SSDs); a 10K-file vault completes in < 1 minute.
- **Risk**:
  - Partial-write corruption — mitigated by write-tmp + `fsync` + atomic rename in the encrypting adapter.
  - Wrong-KEK restore — mitigated by the 8-byte KEK fingerprint in every envelope; error surface is clear.
  - Mid-sweep crash — `migration_state` and `migration_progress` are persisted; restart resumes from the last committed batch.
  - User confusion ("is my data encrypted?") — Settings UI shows per-zone status visibly, the sidebar shows a small lock badge in the personal-folder header when the zone is encrypted.
