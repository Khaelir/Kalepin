# Design: end-to-end encryption for `_users/{email}/_secure/`

## What stage 1 already gave us

Reread `openspec/changes/add-at-rest-encryption-with-e2e-seams/design.md` first. Specifically sections 1 (envelope format), 2 (KEKSource interface), 3 (predicates), and 4 (EncryptingStorageAdapter). Stage 2 is implementation against that contract — we change *what the predicates return* and *which KEKSource is used per path*; we do not change the format, the wire protocol, or the call sites.

## Predicate flips

```ts
// Stage 2 implementation of encryption-predicates.ts
function isE2EEncrypted(path: string): boolean {
  // Match _users/{email}/_secure/...
  if (!path.startsWith('_users/')) return false;
  const rest = path.slice('_users/'.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx < 0) return false;
  const tail = rest.slice(slashIdx + 1);
  return tail === '_secure' || tail.startsWith('_secure/');
}

function shouldIndexPlaintext(path: string): boolean { return !isE2EEncrypted(path); }
function canCollab(path: string): boolean { return !isE2EEncrypted(path); }
function commentBodiesEncrypted(path: string): boolean { return isE2EEncrypted(path); }
function shareLinkMintable(path: string): boolean {
  return !isE2EEncrypted(path) /* && existing personal-folder gates */;
}
```

Single source of change. Every consumer wired correctly in stage 1.

## ClientKEKSource

```ts
class ClientKEKSource implements KEKSource {
  readonly fingerprint = Buffer.alloc(8);  // unknown server-side; sentinel zero

  async wrap(_cek: Buffer): Promise<Buffer> {
    throw new Error('NotAuthoritative — client must wrap');
  }
  async unwrap(_wrappedCek: Buffer): Promise<Buffer> {
    throw new Error('NotAuthoritative — client must unwrap');
  }
}
```

The `EncryptingStorageAdapter` short-circuits when it encounters this source:

```ts
async read(virtualPath): Buffer {
  const source = this.kekSourceFor(virtualPath);
  const bytes = await this.inner.read(virtualPath);
  if (source instanceof ClientKEKSource) return bytes;  // raw envelope to client
  if (!hasEnvelopeMagic(bytes)) return bytes;
  return envelope.decrypt(bytes, virtualPath, source);
}

async write(virtualPath, bytes): void {
  const source = this.kekSourceFor(virtualPath);
  if (source instanceof ClientKEKSource) {
    // bytes ARE the envelope; client encrypted before upload
    if (!hasEnvelopeMagic(bytes)) throw new BadRequestException('expected envelope');
    return this.inner.writeAtomic(virtualPath, bytes);
  }
  // ... stage 1 path
}
```

## Two-tier key hierarchy

Per-file CEKs are wrapped against a **master-KEK** that is generated once per vault and never derived from the passphrase. The passphrase-derived key only wraps the master-KEK. This separation is what makes routine passphrase rotation O(1) and recovery flows possible.

```
   passphrase ──Argon2id──▶ passphrase-KEK ─AES-KW─┐
   (user input)             (derived per session)   │
                                                    ├─wraps─▶  master-KEK   (random 256b,
   recovery   ──Argon2id──▶ recovery-KEK   ─AES-KW─┘           generated once,           cached as
   phrase     (different salt)                                  non-extractable           non-extractable
   (24 BIP-39                                                   CryptoKey)                CryptoKey in
    words)                                                          │                     IndexedDB)
                                                                    │
                                              per-file CEK ◀─AES-KW─┘
                                                    │
                                                    ▼
                                          envelope.wrapped_cek
                                          (in every _secure/ file)
```

Two wrapped copies of the master-KEK live on the server, both opaque:

| Server field                            | Always present? | Set when                                |
|-----------------------------------------|-----------------|-----------------------------------------|
| `user_meta.passphrase_wrapped_kek`      | yes (after setup) | vault is created or passphrase rotates  |
| `user_meta.recovery_wrapped_kek`        | optional         | user opts into recovery + on regenerate |
| `user_meta.passphrase_salt` (16B)       | yes              | vault is created                        |
| `user_meta.recovery_salt` (16B)         | iff recovery on  | recovery generated                      |
| `user_meta.vault_setup_at` (timestamp)  | yes              | vault is created or reset+recreated     |

Master-KEK fingerprint = `HMAC(master-KEK, "kalepin-kek-fp")[:8]`. Stable across passphrase rotations and recovery unlocks. Embedded in every envelope's `kek_fingerprint` field.

## Client-side crypto

```ts
// packages/frontend/src/crypto/master-kek.ts

interface VaultMeta {
  passphrase_wrapped_kek: Uint8Array;
  passphrase_salt: Uint8Array;          // 16B
  recovery_wrapped_kek?: Uint8Array;
  recovery_salt?: Uint8Array;
}

async function setupVault(passphrase: string): Promise<{ masterKek: CryptoKey, meta: VaultMeta }> {
  const masterKek = await crypto.subtle.generateKey(
    { name: 'AES-KW', length: 256 }, /* extractable */ true, ['wrapKey','unwrapKey']);
  // Re-import as non-extractable for in-memory use; the extractable copy is wrapped and discarded.
  const passphrase_salt = crypto.getRandomValues(new Uint8Array(16));
  const passphraseKek = await deriveArgon2(passphrase, passphrase_salt);
  const passphrase_wrapped_kek = await crypto.subtle.wrapKey('raw', masterKek, passphraseKek, 'AES-KW');
  const masterKekHandle = await rebindNonExtractable(masterKek);   // discards the extractable handle
  await idb.set('e2e-master-kek', masterKekHandle);
  return { masterKek: masterKekHandle, meta: { passphrase_wrapped_kek, passphrase_salt } };
}

async function unlockWithPassphrase(passphrase: string, meta: VaultMeta): Promise<CryptoKey> {
  const passphraseKek = await deriveArgon2(passphrase, meta.passphrase_salt);
  const masterKek = await crypto.subtle.unwrapKey(
    'raw', meta.passphrase_wrapped_kek, passphraseKek, 'AES-KW',
    { name: 'AES-KW', length: 256 }, /* extractable */ false, ['wrapKey','unwrapKey']);
  await idb.set('e2e-master-kek', masterKek);
  return masterKek;
}

async function unlockWithRecovery(phrase24: string, meta: VaultMeta): Promise<CryptoKey> {
  if (!meta.recovery_wrapped_kek || !meta.recovery_salt) throw new Error('no recovery configured');
  const recoveryKek = await deriveArgon2(bip39ToBytes(phrase24), meta.recovery_salt);
  const masterKek = await crypto.subtle.unwrapKey(
    'raw', meta.recovery_wrapped_kek, recoveryKek, 'AES-KW',
    { name: 'AES-KW', length: 256 }, false, ['wrapKey','unwrapKey']);
  await idb.set('e2e-master-kek', masterKek);
  return masterKek;
}

async function rotatePassphrase(currentMasterKek: CryptoKey, newPassphrase: string): Promise<VaultMeta> {
  // currentMasterKek is non-extractable but AES-KW can still wrap *it* via wrapKey
  const new_salt = crypto.getRandomValues(new Uint8Array(16));
  const newPassphraseKek = await deriveArgon2(newPassphrase, new_salt);
  const new_wrapped = await crypto.subtle.wrapKey('raw', currentMasterKek, newPassphraseKek, 'AES-KW');
  // PUT to /api/users/me/vault-meta
  return { passphrase_wrapped_kek: new_wrapped, passphrase_salt: new_salt };
}
```

Non-extractable `CryptoKey` cannot be `crypto.subtle.exportKey()`-ed. JavaScript holds only a handle. Persists across reloads in IndexedDB; cleared on logout. The brief window where the master-KEK exists as extractable (during `setupVault`) is the only time the raw key bits exist in JS — and that handle is dropped immediately after the wrap completes.

## Envelope format reuse

Stage 1's envelope format v1 is unchanged. Stage 2 sets:
- `kdf` byte = `0x01` (Argon2id) — informational; the actual unwrap path is two-step (passphrase-KEK → master-KEK → CEK), but the envelope only records the KDF that derived the *outer* key in this hierarchy.
- `kdf_params` = serialized `{salt: 16B, mem: u32, iter: u16, par: u8}` ≈ 23B — the **passphrase salt** (sufficient for clients to know which Argon2 parameters to use; the master-KEK itself doesn't need a KDF since it's randomly generated).
- `wrapped_cek` = AES-KW(**master-KEK**, CEK) — 40B for a 32B CEK.
- `kek_fingerprint` = HMAC(**master-KEK**, "kalepin-kek-fp")[:8] — stable across passphrase rotations.
- `aad.kind` = `"note" | "attachment" | "meta"` (same).
- `aad.z` = `"personal"` (always — `_secure/` is under personal).

The v1 parser already handles the `kdf` byte branching. No new format needed. Per-file envelopes do NOT need to be touched on passphrase rotation, because they reference the master-KEK fingerprint (which is unchanged), and the wrapped_cek is wrapped with the master-KEK (also unchanged).

## Move semantics — the destructive flow

Moving INTO `_secure/`:

```
Frontend confirms: "Moving 1 file into _secure/.
                    This will:
                    • End-to-end encrypt the file
                    • Revoke 2 grants (bob@x, carol@x)
                    • Delete 1 share-link
                    • Clear the PIN
                    Continue?"
                                  │
                                  ▼ Yes
1. Frontend prompts for passphrase if not in IndexedDB.
2. Backend (atomic transaction):
   a. Reads the at-rest envelope, unwraps CEK with server KEK.
   b. Returns the raw CEK to the client over TLS. THIS IS THE LAST TIME.
   c. Revokes all grants on the path.
   d. Deletes all share-links for the path.
   e. Clears the PIN.
   f. Marks the path as "in-flight to E2E" (a temp flag in note_meta).
3. Client wraps CEK with passphrase-derived KEK.
4. Client uploads new envelope as `PUT /api/files/encrypted` (new endpoint).
5. Backend (atomic transaction):
   a. Validates the envelope (header, AAD path matches, kind=note, kdf=Argon2id).
   b. Renames physical file to new virtual path under `_secure/`.
   c. Clears the in-flight flag.
6. Frontend updates UI; sidebar shows the file under _secure/ with lock badge.
```

Moving OUT of `_secure/`:

```
Symmetric. Client decrypts (using cached KEK or fresh passphrase entry),
sends plaintext (within an at-rest envelope wrapped with the server KEK,
or as plaintext bytes that the EncryptingStorageAdapter then envelopes —
implementation choice).
The note is now searchable, collaborable, etc., again.
```

## Feature carve-outs — implementations

### OT collaboration

```ts
// ot.gateway.ts:doc:open
if (!predicates.canCollab(path)) {
  socket.emit('doc:open:rejected', { path, reason: 'e2e-no-collab' });
  return;
}
```

Frontend Editor handles `doc:open:rejected` by switching to local-only mode with a banner: "Concurrent editing is disabled in `_secure/`. Changes save when you're done."

### FTS / semantic / link-index

Already gated by `shouldIndexPlaintext` (stage 1 contract). Stage 2 makes the predicate return false for `_secure/` paths. No code changes — verify in tests.

### Comments

```ts
// comments.controller.ts:create
if (predicates.commentBodiesEncrypted(path)) {
  // Today: 403 with e2e-no-comments
  // Future (separate change): client-encrypted comment bodies
  throw new ForbiddenException('e2e-no-comments');
}
```

### Share-links

Already gated by `shareLinkMintable` (stage 1 contract). Existing links on the path revoked at move time.

### MCP

```ts
// mcp.service.ts wrapTool
async readNote(path, user) {
  if (predicates.isE2EEncrypted(path)) {
    return { kind: 'e2e-encrypted', path };
  }
  // ... existing logic
}
```

### Change-tracking

Already gated by `shouldIndexPlaintext` (stage 1 contract). Stage 2 makes it return false; metadata-only branch activates. UI renders "(content hidden)" for `metadata_only=1` rows.

### download-zip

Decision: include `_secure/` paths as raw envelope bytes. The user has the passphrase and can decrypt locally. The manifest gets a `kind: e2e-encrypted` flag per entry. Backend implementation:

```ts
for entry under requester's tree:
  if isE2EEncrypted(entry.path):
    archive.append(entry.path, raw envelope bytes)
    manifest.push({ path: entry.path, kind: 'e2e-encrypted' })
  else:
    archive.append(entry.path, plaintext)
    manifest.push({ path: entry.path, kind: 'plaintext' })
archive.append('manifest.json', manifest)
```

## Setup dialog — typed-confirmation gate

```
┌─ Set up _secure/ vault ─────────────────────────────────────┐
│ Choose a passphrase. This passphrase encrypts every file in │
│ _secure/ end-to-end. Kalepin servers never see it.          │
│                                                              │
│ Passphrase:        [••••••••••••••••]                       │
│ Confirm:           [••••••••••••••••]                       │
│ Strength:          ████████░░  Strong                       │
│                                                              │
│ ⚠ Lost passphrase = permanently lost data                   │
│   No Kalepin operator, admin, or staff member can recover   │
│   the contents of _secure/ if you forget this passphrase.   │
│   There is no "forgot passphrase" link.                     │
│                                                              │
│   To proceed, type "I understand" below:                    │
│   [_______________]                                          │
│                                                              │
│ Recovery phrase (recommended):                              │
│   ○ Skip — I'll remember the passphrase                     │
│   ● Generate a 24-word recovery phrase                      │
│                                                              │
│ [ Cancel ]                              [ Create vault ]    │
└──────────────────────────────────────────────────────────────┘
```

The "Create vault" button is enabled iff:
- both passphrase fields match,
- zxcvbn score ≥ 3,
- the typed-confirmation field exactly equals `I understand` (case-insensitive, trimmed),
- a recovery option is explicitly chosen (no implicit default).

A checkbox-only acknowledgement is explicitly insufficient. The typed string is what makes the user *read* the warning instead of muscle-memory-clicking through.

## Recovery codes (opt-in)

```
After "Create vault" with recovery selected:
  ┌─ Your recovery phrase ─────────────────────────────────┐
  │ Write this down RIGHT NOW. We will not show it again.  │
  │                                                         │
  │   1. abandon    7. crystal   13. pioneer   19. saddle  │
  │   2. blossom    8. dawn      14. quill     20. tablet  │
  │   3. canyon     9. ember     15. rumor     21. unison  │
  │   ... (24 BIP-39 words)                                │
  │                                                         │
  │ ⚠ Anyone with this phrase can decrypt every file in    │
  │   your _secure/ folder. Treat it like the passphrase.  │
  │                                                         │
  │ Type the 6th word to confirm you wrote it down:        │
  │   [______________]                                      │
  │                                                         │
  │ [ I've saved it — continue ]                            │
  └─────────────────────────────────────────────────────────┘
```

Implementation:
- Generate 256 bits → encode as 24 BIP-39 words (`@scure/bip39` or equivalent — pure JS, no WASM).
- Derive recovery-KEK = Argon2id(phrase-bytes, recovery_salt). Different salt from passphrase to prevent rainbow-attack overlap.
- AES-KW-wrap the **master-KEK** with the recovery-KEK; PUT the wrapped blob to `user_meta.recovery_wrapped_kek`.
- Show the phrase exactly once. Confirm with a "type word N" challenge so the user has actually read/written it before dismissing.
- Recovery flow: user enters phrase → derive recovery-KEK → unwrap master-KEK from `recovery_wrapped_kek` → cache as non-extractable → **forced passphrase rotation** before they can leave Settings (see below).
- Regenerate recovery (Settings → Security): generate fresh phrase, derive new recovery-KEK with a fresh `recovery_salt`, re-wrap the (still-cached) master-KEK, replace `recovery_wrapped_kek` and `recovery_salt`.

## Passphrase rotation

Two trigger points: routine ("change my passphrase") and post-recovery (forced).

### Routine change (Settings → Security → Change passphrase)

```
Pre-condition: vault unlocked (master-KEK in IndexedDB).
              If not unlocked, show passphrase prompt first.

  1. User enters new passphrase + confirm + types "I understand"
     (same gate as setup, with the same threshold + warning).
  2. Client generates fresh `passphrase_salt` (16 random bytes).
  3. Client derives new passphrase-KEK = Argon2id(new-passphrase, new salt).
  4. Client wraps the cached master-KEK with the new passphrase-KEK
     using crypto.subtle.wrapKey (works on non-extractable keys).
  5. PUT { passphrase_wrapped_kek, passphrase_salt } → /api/users/me/vault-meta.
  6. Server replaces both fields atomically.
  7. Per-file envelopes: untouched. master-KEK fingerprint: unchanged.
```

Cost: one Argon2 derivation + one AES-KW wrap + one HTTP request. No file rewrite.

### Post-recovery forced rotation

After a successful `unlockWithRecovery`, the client transitions into a "rotate-required" state. The Settings → Security page renders only the "Set a new passphrase" form, with no skip option, until the rotation succeeds. Rationale: if the user just unlocked via recovery, they don't *know* the passphrase — leaving it in place means the recovery phrase is the sole primary unlock and the wrapped_passphrase_kek is dead weight. Worse, an attacker who later guesses or steals the original passphrase can still unlock; we want to invalidate it.

The frontend enforces this by:
- Setting an in-memory `recoveryUnlockPending = true` flag after `unlockWithRecovery`.
- Refusing navigation away from the rotation form (router guard).
- The flag is cleared only after a successful `rotatePassphrase` call.

The flag is purely client-side — a determined user could circumvent it by closing the tab. That's acceptable: the threat model here is user laziness, not attacker behavior. We surface a banner on every subsequent `_secure/` access that "your vault is currently unlocked via recovery phrase only — please set a new passphrase" until they do.

## Vault reset (the destructive escape hatch)

The honest answer for users who lost both passphrase and recovery phrase. Without this, a user has only support tickets and frustration as options. With it, they can self-serve: destroy the vault, start fresh.

```
┌─ Reset _secure/ vault? ──────────────────────────────────────┐
│ ⚠⚠⚠ DESTRUCTIVE — UNRECOVERABLE                              │
│                                                               │
│ This will permanently delete all 47 files in your _secure/   │
│ folder. They are end-to-end encrypted; no Kalepin operator,  │
│ admin, or staff member can recover the content. Once the     │
│ 24-hour grace period expires, the data is gone forever.      │
│                                                               │
│ Use this only if:                                             │
│   • You have lost your passphrase, AND                        │
│   • You have lost your recovery phrase (or never had one),    │
│   • And you accept that all _secure/ content will be gone.    │
│                                                               │
│ Files that will be destroyed:                                 │
│   • _secure/journal/2026-01-15.md                            │
│   • _secure/passwords.md                                      │
│   • … 45 more (▼ expand to view all)                         │
│                                                               │
│ Type your email address to confirm:                          │
│   alice@example.com expected                                  │
│   [_____________________________________]                    │
│                                                               │
│ [ Cancel ]                          [ Destroy my vault ]     │
└───────────────────────────────────────────────────────────────┘
```

### Server flow

```
POST /api/users/me/secure-vault/reset
  body: { confirm_email: string }   // must equal the user's own email

  1. Auth: existing session (no passphrase needed — that's the entire point).
  2. Validate confirm_email == authenticated user's email (constant-time).
  3. In a single transaction:
     a. Rename `_users/{email}/_secure/` → `_users/{email}/_secure.tombstone-{ts}/`.
        (Just the directory rename; bytes untouched yet.)
     b. UPDATE user_meta SET
          passphrase_wrapped_kek = NULL,
          recovery_wrapped_kek   = NULL,
          passphrase_salt        = NULL,
          recovery_salt          = NULL,
          vault_setup_at         = NULL,
          vault_tombstone_at     = NOW(),
          vault_tombstone_path   = '_users/{email}/_secure.tombstone-{ts}/'.
     c. INSERT INTO note_change (op='vault.reset', metadata_only=1,
          payload={ files_count, tombstone_path, ts }).
     d. INSERT INTO email_outbox (template='secure-vault-reset',
          to=user.email, undo_token=<one-shot HMAC>, expires_at=NOW()+24h).
     e. Bust the tree cache for `_users/{email}/`.
  4. Return 200 OK with { tombstone_path, expires_at }.

GET /api/users/me/secure-vault/reset/undo?token=<one-shot HMAC>
  1. Verify token (HMAC-signed, includes user_id + tombstone_ts + expiry).
  2. If token valid AND expires_at > NOW():
     a. Rename tombstone back to `_users/{email}/_secure/`.
     b. Restore user_meta fields from the audit row.
     c. Delete the email_outbox row.
     d. Bust caches.
     e. Return success page.

Background sweep (every hour):
  - Find rows where vault_tombstone_at IS NOT NULL AND
    vault_tombstone_at < NOW() - 24h.
  - rm -rf the tombstone directory.
  - Clear vault_tombstone_at, vault_tombstone_path.
  - Emit final `vault.reset.finalized` audit event.
```

### Why soft-delete + email + 24h grace

A stolen browser session could trigger this. The cost of being wrong is total data loss for the user. The 24h grace gives us:
- Recovery if the user clicks "destroy" by mistake.
- Recovery if a session was compromised.
- An audit trail the user can read in their inbox ("here's what happened on your account").

The grace window is the entire safety mechanism. The undo link in the email is the canonical recovery path; it's HMAC-signed so the server can verify it without keeping a separate token table.

### What gets cleared, what survives

| State                                    | After reset       | After 24h finalize |
|------------------------------------------|-------------------|--------------------|
| Files under `_secure/`                   | renamed to tombstone | rm -rf'd        |
| `passphrase_wrapped_kek`                 | NULL              | NULL               |
| `recovery_wrapped_kek`                   | NULL              | NULL               |
| `passphrase_salt`, `recovery_salt`       | NULL              | NULL               |
| Cached master-KEK in browser IndexedDB   | cleared client-side on next `_secure/` access | — |
| User account, login, magic-link auth     | untouched         | untouched          |
| Plaintext content outside `_secure/`     | untouched         | untouched          |
| Grants/share-links/PINs (none on `_secure/` per design) | n/a | n/a    |
| `note_change` log                        | preserves vault.reset event indefinitely | also preserves vault.reset.finalized |

After reset finalizes, the user can immediately set up a fresh vault (`setupVault` flow) with a new passphrase. The new master-KEK has a different fingerprint; nothing from the old vault is recoverable.

## Sharing E2E notes — why it's deferred

To grant Bob read on Alice's `_secure/journal.md`, the CEK must be wrapped with a key Bob can use. Two options:

1. **PKI**: every user has an X25519 public key (published) + private key (in their browser, derived alongside the master KEK). Granting = wrap CEK with grantee's public key. Grantee unwraps with their private key.
2. **OOB**: Alice gives Bob a shared secret out-of-band (e.g., a one-time URL with the wrapped CEK in the fragment). Brittle.

PKI is the right answer. It's enough work to be its own change (`add-e2e-grant-sharing`):
- Per-user keypair generation on first `_secure/` setup.
- Public key store (server-side, integrity-verified by HMAC against KEK).
- Grant minting wraps CEK against the grantee's public key.
- Grantee unwraps in browser.
- Public-key rotation, key recovery, etc.

For now: granting on `_secure/` paths returns 400. Users can move out of `_secure/`, share, then move back if they need to share something specific.

## Multi-device

Each browser must derive the KEK once. Salt is per-user (server-stored, unencrypted — the security is in the passphrase, not the salt). User enters passphrase on each new browser; subsequent sessions on that browser load the cached non-extractable key from IndexedDB.

Future: QR-pair flow or wrapped-key transport via the existing magic-link mechanism. Deferred.

## Tests — the leak sweep

The load-bearing test. Mirrors the personal-folders leak sweep:

```
packages/e2e/tests/e2e-secure-subfolder.spec.ts:

setup:
  Alice creates _secure/journal.md with:
    path = "_users/alice@x.com/_secure/UNIQ-PATH-{run}.md"
    content includes UNIQ-CONTENT-{run}
    attachment named UNIQ-ATTACH-{run}.png
    attempt to comment containing UNIQ-COMMENT-{run}

assert:
  As Bob, recursively scan responses + WS events for any UNIQ token across:
    - GET /api/files/tree
    - GET /api/files/read (every variation)
    - GET /api/search/* (FTS, semantic)
    - GET /api/links/* (backlinks, graph, autocomplete)
    - GET /api/comments?path=*
    - GET /api/updates*
    - WS file:tree-update, presence, OT events
    - GET /share/* (Bob mints if possible — should be rejected)
    - Every MCP tool with parameters that could surface paths
  Expect zero matches.

assert:
  As Alice, opening the note works (with passphrase entry).
  FTS does not return the note for any of Alice's queries.
  Comments cannot be created on the path (403).
  download-zip includes raw envelope bytes for the path.
```

## Open questions still unresolved

- **Multi-device transport**: QR-pair vs. passphrase-only re-entry. Deferred.
- **Per-user public keys for grant-share**: separate change `add-e2e-grant-sharing`.
- **download-zip behavior**: include vs. skip `_secure/`. Tentative: include raw envelope.

## Decisions captured (resolved during design review)

- **Two-tier key hierarchy** (master-KEK + passphrase-wrapped + recovery-wrapped) over direct passphrase-keying of CEKs. Enables O(1) passphrase rotation and a coherent recovery flow.
- **Typed-confirmation gate** at setup ("type 'I understand'"), not a checkbox. Plus a confirm-passphrase field and a zxcvbn ≥ 3 strength gate. Recovery-code choice is explicit (no implicit default).
- **Recovery codes UI** lives in the setup flow itself (offered alongside passphrase creation) and in Settings → Security (regenerate). Phrase shown once; "type word N" challenge before dismissal.
- **Vault reset escape hatch** with typed-email confirmation + 24h soft-delete grace + emailed undo link. Auth = existing session; no passphrase required (it's the lost-passphrase recovery path).
- **Forced post-recovery passphrase rotation** after `unlockWithRecovery`: client refuses to leave the rotation form until a new passphrase is set.
