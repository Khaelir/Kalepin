# Encryption & Sharing Roadmap

Living document. Tracks the six OpenSpec changes that together deliver Kalepin's encryption-and-sharing story. Updated when decisions change or a phase ships.

## Threat models, in plain language

| Stage | Defends against | Does NOT defend against |
| --- | --- | --- |
| **Stage 1** — at-rest encryption (whole vault) | Stolen disk image, leaked S3 backup, mistakenly public bucket, forensic dump after seizure | Live server compromise, malicious admin, subpoena |
| **Stage 2** — E2E for `_users/{email}/_secure/` | All of stage 1 *plus* live server compromise, malicious admin, subpoena | Endpoint compromise (key derived in browser), forgotten passphrase (data is gone) |

## The six changes

The order below is the *fast path* to E2E. Phases 2–5 are independent and can ship before, between, or after stages 1 and 2.

| # | Change | Status |
| --- | --- | --- |
| 1 | `add-at-rest-encryption-with-e2e-seams` | ✅ archived `archive/2026-06-10-add-at-rest-encryption-with-e2e-seams/` |
| 2 | `add-access-metadata` | ✅ archived `archive/2026-05-03-add-access-metadata/` |
| 3 | `add-comments-on-public-shares` | ⏳ drafted, not started |
| 4 | `add-shared-with-me-grants` | ✅ archived `archive/2026-05-01-add-shared-with-me-grants/` |
| 5 | `add-per-note-pin` | ✅ archived `archive/2026-05-01-add-per-note-pin/` |
| 6 | `add-e2e-secure-subfolder` | ✅ archived `archive/2026-06-10-add-e2e-secure-subfolder/` (UI hidden — see below) |

> **Phase 6 status (2026-06-10):** Backend shipped and archived; user-facing UI remains hidden behind `E2E_SECURE_FOLDER` (default off) pending an editor-parity rework. Do NOT flip the flag on by default until that rework ships. See the archived `archive/2026-06-10-hide-secure-folder-ui/` for the gating mechanism.

```
Now ──────────────────────────────────────────────────────────────► E2E

[Today]            All six changes drafted, roadmap captured
       │
       ▼
[~1 week]          Implement #1 (at-rest + seams)
                   • Vault encrypted at rest
                   • All features still work
                   • Stage-2 seams in place but inert
       │
       ▼
[~1-2 weeks]       SOAK — run #1 in real use
                   Catch envelope/format bugs
                   Verify backup/restore round-trip
       │
       ▼
[~1.5 weeks]       Implement #6 (E2E for _secure/)
                   • Passphrase UX, key store, lock dialog
                   • Flip predicates for _secure/
                   • Run the leak-sweep test
       │
       ▼
                   E2E shipped. Pick up #2-5 after.
```

## Locked decisions

These are baked into the proposal documents below. Listed here for cross-referencing.

- **Stage 1 scope**: entire vault — both `vault/` and `_users/`. Obsidian-on-disk compatibility is traded for stronger default. The Obsidian *plugin* still works because it talks the API (WebSocket + HTTP), not the disk.
- **KEK source (stage 1)**: file-based. Default `/run/secrets/kalepin.kek`, mode `0400`, 32 random bytes. Interface (`KEKSource`) stays open for KMS / HSM later.
- **Envelope format (v1)**: self-describing header — `magic | version | algorithm | KDF | IV | wrapped_CEK_length | wrapped_CEK | AAD | ciphertext | auth_tag`. AAD includes the path to prevent swap attacks.
- **Encryption layer**: an `EncryptingStorageAdapter` wraps the existing `RoutingStorageAdapter`. `FilesService` and downstream services see plaintext markdown — they're unchanged.
- **Per-file grants**: not per-folder. "Share folder" is a UI bulk operation that mints N grants. New files added to a shared folder are not auto-shared.
- **Grant default expiry**: none (perpetual until revoked).
- **Access log retention**: GDPR-compliant. Default 90 days, configurable. Per-user right-to-erasure endpoint.
- **PIN**: per-note, server-side gate (bcrypt + rate limit). 8 chars. NOT a key-derivation source. Once-per-session unlock for owner/grantee; per-browser-session for public viewers.
- **Move-to-`_secure/` semantics**: revokes all grants and clears the PIN. UI confirms first.
- **Sharing E2E notes (interaction between #4 and #6)**: requires per-user public keys (Ed25519 / X25519). Decision deferred to stage 2's design.md.

## Stage 2 contract (carried by stage 1's design)

Stage 1's `design.md` is the contract for stage 2. Every seam in stage 1 has a paragraph saying what stage 2 sets/swaps:

- **Predicate hooks**: `isEncryptedAtRest(path)`, `isE2EEncrypted(path)`, `should_index_plaintext(path)`, `can_collab(path)`. Stage 1 makes the first two true everywhere and the last two true everywhere. Stage 2 makes `isE2EEncrypted` true under `_users/{email}/_secure/` and the others false there.
- **Envelope format versioning**: `version` byte distinguishes server-keyed (`0x01`) from client-keyed (`0x02`). Both formats stable; the wrapped-CEK and KDF metadata fields differ.
- **Migration primitive**: `unwrapCEKWithKEK(serverKEK) → wrapCEKWithKEK(userKEK)` is the single operation that flips a note from at-rest to E2E. Ciphertext bytes do not change.
- **Change-tracking metadata-only mode**: stage 1 stores diffs as metadata-only (hash + size + author + ts) for a forward-compat path. Stage 2 enforces metadata-only for `_secure/` paths.

## Open questions per phase

Questions to answer when each change is picked up. Listed here so they're not re-derived.

### Stage 1
- KEK rotation: schedule? Manual? Per-rotation re-wraps every CEK; ciphertext bytes untouched.
- Backup operator runbook: where does the KEK live during backup? (Decision: KEK NOT in archive; documented separately.)

### Access metadata
- IP hashing: per-user salt or global? Per-user is more privacy-preserving but breaks "weird login" detection.
- Anonymous viewer log: log "anonymous" plus IP-hash, or skip entirely?

### Comments on public shares
- Sign-in CTA: opens magic-link form inline, or redirects to `/login?return=<share>`?
- Spam: anonymous-then-signin reduces it but does not eliminate. Rate-limit?

### Shared-with-me
- Bulk folder share UX: a single dialog showing the file list with per-file checkboxes?
- New-file-in-shared-folder prompt: inline toast, or a dialog?
- Revocation UX: from the grantor's side (per-grant), per-grantee (revoke all)?

### Per-note PIN
- Forgotten PIN: owner can always reset (they own the note). Grantees cannot.
- Rate-limit policy: lockout after N attempts? Time-window?

### Stage 2 (E2E)
- Multi-device key transport: passphrase re-entry, QR pair, wrapped-key-on-server?
- Per-user public keys for grant-share: Ed25519 vs X25519. Server-published vs user-published.
- Recovery codes: opt-in, second wrapped CEK by recovery key?

## Index

- `openspec/changes/add-at-rest-encryption-with-e2e-seams/`
- `openspec/changes/add-access-metadata/`
- `openspec/changes/add-comments-on-public-shares/`
- `openspec/changes/add-shared-with-me-grants/`
- `openspec/changes/add-per-note-pin/`
- `openspec/changes/add-e2e-secure-subfolder/`
