# Add per-note PIN protection

## Why

Some notes need a thin extra gate — "even if you're logged in, even if you're a grantee, prove you mean it before opening this." Examples: a quarterly review with sensitive performance notes, a passwords appendix, a journal entry not meant for screen-shares. The 8-character PIN is **not** a cryptographic primitive — its entropy (10⁸ for digits, 36⁸ for alphanumeric) is too low for key derivation. It's a server-side gate that adds friction against opportunistic snooping ("don't let my colleague see this on a shared screen") without the UX cost of a real passphrase.

## What Changes

- **Per-note opt-in PIN**: any note can have a PIN set by its owner. PIN ∈ 8 alphanumeric characters (case-sensitive).
- **Storage**: `note_meta` table — `path PRIMARY KEY, pin_hash TEXT, pin_set_by TEXT, pin_set_at INTEGER, pin_failed_attempts INTEGER, pin_last_attempt_at INTEGER`. PIN stored as bcrypt (cost 12).
- **Set / change / unset**: `POST /api/notes/:path/pin`, `DELETE /api/notes/:path/pin` — owner-only.
- **Unlock**: `POST /api/notes/:path/pin/verify` returns a session-scoped unlock token. Token TTLs:
  - Owner: 24 hours.
  - Grantee: 24 hours.
  - Public-share viewer: browser-session only (cookie cleared on close).
- **Read/write gating**: every read/write/comment/share-resolve route checks for an active unlock cookie when `pin_hash` is non-null. Missing/expired/wrong → 423 Locked with a hint to call `/pin/verify`.
- **Rate limiting**: 5 failed attempts in a 15-minute rolling window → 15-minute lockout per (path, viewer). Lockout ends automatically.
- **PIN reset**: owner can reset (clear) anytime by re-authenticating. Grantees cannot reset.
- **MCP**: PIN-protected notes return a `pin-protected` sentinel from MCP read tools (instead of plaintext). Owners can include a one-time unlock token in MCP requests via `X-Kalepin-Unlock`.
- **Stage-2 carve-out**: PIN works only on at-rest paths. Setting a PIN on `isE2EEncrypted` paths is rejected (the real protection is the passphrase).
- **Tests**: PIN gates every authenticated read/write route; rate limit triggers and recovers; owner reset works without knowing the PIN; grantee cannot reset; expired unlock returns 423; correct PIN unlocks.

## Capabilities

### New Capabilities

- `pin-protection`: Per-note PIN gate with bcrypt-stored 8-char PINs, role-aware unlock TTLs, rate limiting, and owner reset path.

### Modified Capabilities

- `share-links`: Public viewer challenges for the PIN before resolving the document.
- `file-management`: Read/write routes gate on PIN unlock state when `pin_hash` is set.
- `mcp-tool-registration`: Read tools return a sentinel for PIN-locked paths.

## Impact

- **Backend**: new module `packages/backend/src/pin/`. Cookie-based unlock token (signed JWT, short TTL, path-scoped).
- **Frontend**: PIN-set dialog from note context-menu; PIN-prompt overlay on note-open when locked; share-link viewer prompts before rendering.
- **DB**: `note_meta` table.
- **Risk**: PIN treated as "real" security despite low entropy. Mitigation: clear UI labeling — "lightweight PIN, not E2E encryption"; documented in the privacy section.
