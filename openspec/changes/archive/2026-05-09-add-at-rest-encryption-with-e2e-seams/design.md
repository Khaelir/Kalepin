# Design: at-rest encryption with per-zone admin toggle and E2E seams

This document is the **contract for stage 2**. Every seam in stage 1 has a paragraph below saying what stage 2 sets, swaps, or extends. The goal is that picking up `add-e2e-secure-subfolder` later is execution, not re-derivation.

## 1. Envelope format v1

```
 ┌────────────────────────────────────────────────────────────────────┐
 │ magic     "KE1\0"        4B   ASCII "KE1" + NUL                    │
 │ version   u8             1B   0x01                                 │
 │ algorithm u8             1B   0x01 = AES-256-GCM                   │
 │ kdf       u8             1B   0x00 = none (server KEK direct)      │
 │                               0x01 = Argon2id (stage 2)            │
 │                               0x02 = HKDF-SHA256 (key derivation   │
 │                                       from a wrapping key, future) │
 │ kdf_params_len u16 LE    2B   0 in stage 1                         │
 │ kdf_params     bytes     n    (stage 2: salt + memory + iter +     │
 │                                parallelism, ~32B)                  │
 │ iv             12B            random per write                     │
 │ wrapped_cek_len u16 LE   2B   length of next field                 │
 │ wrapped_cek    bytes     n    AES-KW(KEK, CEK), 40B in stage 1     │
 │                               for a 32B CEK                        │
 │ kek_fingerprint 8B            HMAC-SHA256(KEK, "kalepin-kek-fp")   │
 │                               truncated to 8B                      │
 │ aad_len        u16 LE    2B   length of AAD                        │
 │ aad            bytes     n    UTF-8 JSON: {"v":1,"path":...,        │
 │                                "kind":"note"|"attachment"|"meta",  │
 │                                "z":"personal"|"shared"}            │
 │ ciphertext     bytes     n    AES-256-GCM(CEK, IV, plaintext, AAD) │
 │ auth_tag       16B            GCM tag                              │
 └────────────────────────────────────────────────────────────────────┘
```

**Stage 2 contract:** the envelope format is unchanged. Stage 2 sets:
- `kdf` = `0x01` (Argon2id)
- `kdf_params` = the Argon2 parameters chosen at the user's first passphrase entry (salt is per-user, stored unencrypted in the user record; memory/iter/parallelism are global tunables)
- `wrapped_cek` = `AES-KW(passphrase_derived_kek, CEK)`
- `kek_fingerprint` = `HMAC(passphrase_derived_kek, "kalepin-kek-fp")[:8]` — distinguishes server-keyed from user-keyed envelopes at a glance during debugging

The same parser handles both. The same ciphertext bytes (the bulk of the file) never need re-encryption to migrate from stage 1 to stage 2.

**AAD design rationale:** binding the path into AAD prevents a malicious operator from swapping ciphertext blobs between paths (e.g., overwriting `journal.md` with `groceries.md`'s ciphertext, then watching what gets indexed). Including the zone (`"z"`) lets us catch a zone-misconfiguration: an envelope with `z=personal` should never live under `vault/`, and the AAD check would fail if it did.

## 2. KEK source interface

```ts
interface KEKSource {
  readonly fingerprint: Buffer;            // 8 bytes
  wrap(cek: Buffer): Promise<Buffer>;      // returns wrapped_cek
  unwrap(wrappedCek: Buffer): Promise<Buffer>;
  rotate?(newSource: KEKSource): Promise<void>;  // optional, used by KEK rotation
}
```

Implementations in stage 1:
- `FileKEKSource(path)` — reads 32 bytes from `KALEPIN_KEK_FILE`. Refuses to start if the file is not exactly 32 bytes, or its mode is not `0400` / `0600` (root-owned). Caches the KEK in memory; never persists it.
- `EnvKEKSource()` — reads hex-encoded 32 bytes from `KALEPIN_KEK`. Refuses to start if `NODE_ENV === 'production'`. For dev/test only.

**Stage 2 contract:** stage 2 adds:
- `ClientKEKSource` — never resolves the KEK on the server; it's a marker source whose `wrap`/`unwrap` throw `NotAuthoritativeError`. The `EncryptingStorageAdapter` short-circuits when it encounters this source: reads return ciphertext bytes verbatim (the client decrypts), writes accept ciphertext bytes verbatim (the client encrypted before upload). The KEK actually lives in IndexedDB on the client, derived from a passphrase via Argon2id.
- The selection of `KEKSource` becomes path-driven: stage 2's `EncryptingStorageAdapter` consults `isE2EEncrypted(path)` and uses `ClientKEKSource` for those paths, `FileKEKSource` (or whatever else) for the rest.

## 3. Predicates (the seams)

```ts
// packages/backend/src/crypto/encryption-predicates.ts
export interface EncryptionPredicates {
  isEncryptedAtRest(path: string): boolean;       // is this file an envelope on disk?
  isE2EEncrypted(path: string): boolean;          // is the keyholder a client?
  shouldIndexPlaintext(path: string): boolean;    // can FTS/embeddings/links see content?
  canCollab(path: string): boolean;               // can the OT gateway open this doc?
  commentBodiesEncrypted(path: string): boolean;  // are comment bodies opaque to server?
  shareLinkMintable(path: string): boolean;       // can /api/share-links create a link?
}
```

Stage 1 implementation (data-driven for `isEncryptedAtRest`, constants for the rest):

```
isEncryptedAtRest(path):
    if isE2EEncrypted(path): return true             // stage 2 is also "at rest"
    zone = zoneFor(path)                              // 'personal' | 'shared'
    return encryptionZones.get(zone).enabled
isE2EEncrypted(path):                  return false   // stage 2 flips
shouldIndexPlaintext(path):            return true    // stage 2 flips for E2E
canCollab(path):                       return true    // stage 2 flips for E2E
commentBodiesEncrypted(path):          return false   // stage 2 may flip for E2E
shareLinkMintable(path):               return true    // existing personal-gate still applies
```

**Stage 2 contract:** stage 2 changes ONLY `isE2EEncrypted` (returns true under `_users/{email}/_secure/`) and the four other predicates *consult* it:

```
shouldIndexPlaintext(path):  return !isE2EEncrypted(path)
canCollab(path):             return !isE2EEncrypted(path)
commentBodiesEncrypted(path):return isE2EEncrypted(path)
shareLinkMintable(path):     return !isE2EEncrypted(path) && /* existing gates */
```

Every call site that consults a predicate today is wired correctly for stage 2 — we only flip the predicate value, not the call sites.

## 4. EncryptingStorageAdapter

Wraps `RoutingStorageAdapter`. Decision points:

```ts
async read(virtualPath): Buffer {
  const bytes = await inner.read(virtualPath);
  if (!hasEnvelopeMagic(bytes)) return bytes;        // plaintext passthrough
  return envelope.decrypt(bytes, virtualPath, this.kekSourceFor(virtualPath));
}

async write(virtualPath, plaintext): void {
  if (!predicates.isEncryptedAtRest(virtualPath)) {
    return inner.write(virtualPath, plaintext);      // plaintext write
  }
  const cipherBuf = await envelope.encrypt(plaintext, virtualPath,
                                           this.kekSourceFor(virtualPath),
                                           zoneFor(virtualPath));
  // Atomic: write to .tmp, fsync, rename
  await inner.writeAtomic(virtualPath, cipherBuf);
}
```

**Auto-detect on read.** Plaintext passthrough is what makes the runtime toggle safe: during a sweep, files at any given moment are either envelope or plaintext, and reads handle both. The magic check is 4 bytes — negligible.

**KEK source selection.** Stage 1 always returns `FileKEKSource` (or `EnvKEKSource`). Stage 2 consults `isE2EEncrypted(path)` and returns `ClientKEKSource` for those paths.

**Stage 2 contract:**
- The `kekSourceFor(virtualPath)` method already exists in stage 1 — it's just constant. Stage 2 adds the predicate consult.
- The `read()` short-circuit for `ClientKEKSource` is the same logic as plaintext passthrough: return raw bytes to the caller. The frontend interceptor handles decryption.

## 5. Per-zone state

```sql
CREATE TABLE encryption_zones (
  zone TEXT PRIMARY KEY,                       -- 'personal' | 'shared'
  enabled INTEGER NOT NULL DEFAULT 0,          -- 0 | 1
  kek_fingerprint BLOB,                        -- last KEK that wrote this zone
  migration_state TEXT NOT NULL DEFAULT 'idle',-- idle | encrypting | decrypting
  migration_progress INTEGER NOT NULL DEFAULT 0,  -- count
  migration_total INTEGER NOT NULL DEFAULT 0,
  migration_started_at INTEGER,                -- unix ms
  updated_at INTEGER NOT NULL
);

INSERT INTO encryption_zones VALUES
  ('personal', 1, NULL, 'idle', 0, 0, NULL, strftime('%s','now') * 1000),
  ('shared',   0, NULL, 'idle', 0, 0, NULL, strftime('%s','now') * 1000);
```

Service-level cache: `EncryptionZonesService.get(zone)` reads from a 1-second cache to avoid hot-pathing SQLite on every storage call. Cache is invalidated on writes from the admin endpoint.

## 6. Migration sweep

```
   admin POSTs /api/admin/encryption/zones/personal/decrypt
                         │
                         ▼
   EncryptionZonesService.startMigration('personal', 'decrypting')
                         │
                         ▼
   MigrationSweepService walks the physical root for that zone:
     for each file:
       if isE2EEncrypted(virtualPath): skip
       read bytes
       if hasEnvelopeMagic && decrypting: write plaintext atomically
       elif !hasEnvelopeMagic && encrypting: write envelope atomically
       else: noop
       progress++; persist every 100 files
                         │
                         ▼
   On completion: zone.enabled = (target state); migration_state = 'idle'
```

**Idempotency.** Crash-safe: re-running picks up where it left off because `hasEnvelopeMagic` tells us the per-file state. Concurrent app reads/writes are safe (auto-detect).

**Atomicity.** Per-file: write-tmp + `fsync(tmp)` + `rename(tmp, dest)`. The rename is atomic on POSIX; a crash mid-rename leaves the original intact.

**Skipping E2E.** Stage 2 paths (`_users/{email}/_secure/`) are skipped. Their CEKs are wrapped by client KEKs the server doesn't have.

**Stage 2 contract:** the sweep is unchanged in stage 2. The skip logic already filters E2E paths.

## 7. Change-tracking metadata-only mode

Today, `change-tracking` stores raw diffs in the `note_changes` table. Diffs of plaintext are useful (UI shows them); diffs of E2E ciphertext leak nothing useful and are wasteful. Stage 1 introduces a metadata-only mode:

```
recordChange(path, oldText, newText, userEmail):
    if predicates.shouldIndexPlaintext(path):
        // existing path: store full diff
        store({ path, diff_text, ..., metadata_only: 0 })
    else:
        // metadata-only path
        store({
          path,
          old_hash: sha256(oldText),
          new_hash: sha256(newText),
          old_size: oldText.length,
          new_size: newText.length,
          op_type: classifyEdit(oldText, newText),  // 'insert' | 'delete' | 'replace'
          author: userEmail,
          ts: now(),
          diff_text: null,
          metadata_only: 1
        })
```

In stage 1, `shouldIndexPlaintext` is true everywhere, so this branch never activates. The DB column `metadata_only` is added now so stage 2 doesn't migrate the table.

**Stage 2 contract:** stage 2 returns `false` for `_secure/` paths. The metadata-only branch activates; the audit trail survives, but no plaintext leaks. UI for change feed must check `metadata_only` and render "(content hidden)" instead of a diff.

## 8. KEK fingerprint and rotation

```
fingerprint = HMAC-SHA256(KEK, "kalepin-kek-fp")[:8]
```

8 bytes is plenty to distinguish KEKs in a deployment. Stored in every envelope. Used:
- **At read time:** if `envelope.kek_fingerprint != currentKEK.fingerprint`, throw `WrongKEKError` with the fingerprint mismatch surfaced. This is the "wrong-KEK restore" path — clear error rather than a meaningless GCM-tag failure.
- **At rotation time:** the rotation routine `rotateKEK(oldSource, newSource)` walks every encrypted file, unwraps the CEK with `oldSource`, re-wraps with `newSource`, rewrites the envelope. Ciphertext bytes never change. Same primitive as the migration sweep.

**Stage 2 contract:** stage 2 envelopes have a different fingerprint computed against the user's passphrase-derived KEK. The same `WrongKEKError` path triggers if the user's passphrase is wrong, with a clearer "wrong passphrase" surface.

## 9. KEK custody — operator runbook

The KEK is the secret that protects every byte of encrypted data on disk. The runbook is in README's operator section, but the load-bearing rules:

1. **The KEK MUST NOT live in the same backup as the data.** Typically: data goes to S3, KEK lives in a password manager / HashiCorp Vault / printed paper / Yubikey-encrypted file in a different bucket.
2. **The KEK file SHOULD be `0400 root:root` on a tmpfs mount.** A docker secret on `/run/secrets/kalepin.kek` is the recommended path.
3. **KEK rotation should be scheduled** (e.g., yearly) and is `kalepin-rotate-kek --new-kek-file=/run/secrets/kalepin.kek.new`. After completion, the old KEK can be destroyed.
4. **Loss of the KEK = loss of all encrypted data.** No recovery path. This is the trade-off; it is the entire point of encryption.

**Stage 2 contract:** stage 2 introduces a *second* keyholder (the user's passphrase). Loss of *either* the server KEK *or* the user passphrase makes E2E data unrecoverable. The runbook must be updated.

## 10. The download-zip exception

`GET /api/files/download-zip` produces a tar.gz of the requester's accessible content. In stage 1, the requester does not have the KEK. So the handler decrypts in-stream as it walks entries:

```
for each entry in (vault/ + own personal/):
    raw = storage.read(virtualPath)        // EncryptingStorageAdapter decrypts
    archive.append(virtualPath, raw)       // plaintext goes into the tar
```

The user receives a plaintext tar. They can re-encrypt locally if they want.

**Stage 2 contract:** `_secure/` paths cannot be decrypted server-side. The handler either skips them with a manifest entry (`{ path, kind: 'e2e-encrypted', size: N }`) or appends raw envelope bytes (which the user can decrypt locally with their passphrase). Decision deferred to stage 2; the handler structure makes either implementable.

## 11. UI: per-zone toggle

Settings → Admin → Encryption:

```
┌─ Encryption ──────────────────────────────────────────────────┐
│                                                               │
│  Personal vault                                               │
│  ████████████████████████████████████████████████████  ON     │
│  1,234 files encrypted · KEK fingerprint a3f9...e2b1          │
│  [ Decrypt ]                                                  │
│                                                               │
│  Shared vault                                                 │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  OFF    │
│  567 files plaintext                                          │
│  [ Encrypt ]                                                  │
│                                                               │
│  ⚠ When the shared vault is encrypted, Obsidian users         │
│    reading the disk directly will not be able to open files.  │
│    The Obsidian plugin (which uses the API) keeps working.    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

A confirmation dialog precedes any flip. During a sweep, the button shows progress and the zone is locked.

**Stage 2 contract:** stage 2 adds a third row, "End-to-end encrypted folder", that's not a zone toggle but a folder-creation action. The encryption settings page links to it.

## 12. Test plan

Unit:
- `envelope.encrypt → decrypt` round-trips arbitrary bytes; AAD changes detected; wrong KEK detected.
- `EncryptingStorageAdapter` plaintext passthrough; envelope decrypt; predicate-driven write branch; atomic write.
- `EncryptionZonesService` cache invalidation.
- `MigrationSweepService` resumable, idempotent, skips E2E paths.
- `KEKSource` rejects malformed file, wrong mode, wrong length.

Integration:
- API still serves plaintext for every existing endpoint (smoke).
- Backup → restore round-trip preserves every byte.
- Wrong-KEK restore fails fast with `WrongKEKError`.

E2E (`packages/e2e/tests/at-rest-encryption.spec.ts`):
- Default: `_users/*` is envelope on disk; `vault/*` is plaintext on disk.
- Admin flips `shared` to encrypted: every file in `vault/*` becomes envelope; API still serves plaintext.
- Admin flips `personal` to plaintext: every file in `_users/*` becomes plaintext; API still serves plaintext.
- Mid-sweep crash: restart resumes; final state is consistent.
- KEK rotation: ciphertext bytes unchanged; new fingerprint in every envelope.

## 13. Open issues for stage 2 to settle (deferred)

- Multi-device key transport.
- Per-user public keys for grant-share interaction.
- Recovery codes — opt-in second wrapped CEK by recovery key.
- Whether `download-zip` skips or includes `_secure/` raw bytes.

### Notes from stage-1 contract verification (12.3)

The stage-2 contract test (`packages/backend/src/encryption/stage2-contract.test.ts`)
flips `isE2EEncrypted` for one fake path and verifies four call sites cascade:

- ✅ FTS index (`SearchService.indexNote`, `indexNoteEmbeddings`) skips the path and purges any prior plaintext row, so flipping a path to E2E never leaves stale plaintext in `notes_fts`.
- ✅ Share-link mint (`ShareLinksService.getOrCreate`) throws `BadRequestException` for E2E paths with a structured `end-to-end encrypted` reason.
- ✅ MCP `read_note` returns a `kind: e2e-encrypted` sentinel block instead of plaintext (verified via code review and predicate-cascade test; full Nest-bootstrap MCP test deferred).
- ✅ OT gateway `doc:open` sends an error frame with `code: 'e2e-encrypted'` instead of opening a session (verified via code review and predicate cascade; full WS integration test deferred).

Two questions surfaced during wiring:

1. **`indexNoteComments` and `indexCommentEmbeddings` are not yet predicate-gated.** Stage 1 leaves them unconditional — they index plaintext from the comments sidecar regardless of zone. This is intentional for now (commentBodiesEncrypted is still false everywhere in stage 1) but stage 2 must also gate these two methods when comments-on-E2E flips. Tracked as a todo at the call sites where `commentBodiesEncrypted` would be consulted.
2. **Link index (`LinkIndexService`) is not yet predicate-gated.** Wikilink parsing today runs over every markdown body. Stage 2 will need to skip parsing for `shouldIndexPlaintext === false` paths. This is a small follow-up — the parser is already a single entry point — but was scoped out of stage 1 since the link index already runs on plaintext-only flows.

Neither blocks stage 2's flip; both are additional call sites the predicate must reach when `_secure/` lands. The predicate interface and the global injection surface are sufficient — only the call-site wiring needs to be added.
