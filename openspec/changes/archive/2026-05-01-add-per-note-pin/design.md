# Design: per-note PIN protection

## Honest framing

A PIN is a **friction layer**, not a cryptographic protection. With 8 alphanumeric characters (62⁸ ≈ 218 trillion) bcrypt at cost 12 is fine; with 8 digits (10⁸ = 100M), bcrypt at cost 12 still buys hours-to-days of brute-force time, which is plenty against opportunistic snooping but useless against a leaked DB dump. The UI labels accordingly.

## Schema

```sql
CREATE TABLE note_meta (
  path TEXT PRIMARY KEY,
  pin_hash TEXT,                          -- bcrypt; null = no PIN
  pin_set_by TEXT,                        -- canonical email
  pin_set_at INTEGER,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_last_attempt_at INTEGER,
  pin_lockout_until INTEGER               -- nullable; non-null = currently locked out
);
```

This table is general-purpose ("note metadata") so future per-note flags (e.g., archived, pinned-to-top) can extend it.

## Unlock token

A signed JWT in an HttpOnly cookie:

```
{
  "sub": "alice@x.com",          // viewer email or "anonymous-{share_code}"
  "path": "_users/alice/foo.md", // path-scoped
  "exp": <unix>,                 // 24h for auth, session for anon
  "kind": "owner" | "grantee" | "share-viewer"
}
```

Cookie name: `kalepin_pin_unlock_<path-hash>` (per-path cookie keeps tokens isolated; truncated SHA-256 of path is the suffix).

For session-only cookies (public viewer), no `Max-Age` set; cleared on browser close.

## Verify endpoint

```
POST /api/notes/:path/pin/verify
Body: { "pin": "abcd1234" }

Response 200: Set-Cookie: kalepin_pin_unlock_<hash> = <jwt>; HttpOnly; Secure; SameSite=Lax
Response 423: { "lockoutUntil": 1700000000 }   // currently locked out
Response 401: { "remainingAttempts": 3 }        // wrong PIN
```

## Gating in routes

```
async readFile(path, user, req):
    if note_meta.pin_hash for path is not null:
        const cookie = req.cookies[`kalepin_pin_unlock_${pathHash(path)}`]
        if not cookie or jwt.verify fails or jwt.exp < now: throw 423 Locked
        if jwt.path !== path: throw 423 Locked    // tampering guard
        if jwt.sub !== user.email and jwt.kind !== 'share-viewer': throw 423 Locked
    // proceed
```

Same gate on `writeFile`, `move` (only on src), `delete`, `comment.create`. Tree listings DO show the path even when locked — just opening returns 423.

## Rate limit

```
on POST /pin/verify with wrong PIN:
    pin_failed_attempts++
    pin_last_attempt_at = now
    if pin_failed_attempts >= 5 and now - first_attempt_in_window < 15 min:
        pin_lockout_until = now + 15 min
        pin_failed_attempts = 0   // reset for next window
```

Sliding window per (path, viewer). Lockout is per (path, viewer), so a third user can still try.

## Owner reset

`DELETE /api/notes/:path/pin` clears `pin_hash` and resets counters. Requires owner auth (no PIN required — that's the reset). Posts a `pin-reset` row to `access-log` if `add-access-metadata` is shipped.

## Stage-2 interaction

Setting a PIN on `isE2EEncrypted` paths returns 400 with: "The PIN is a server-side gate. End-to-end encrypted notes are protected by your passphrase, not by a PIN." UI hides the "Set PIN" action for `_secure/` paths.

## MCP

Read tools (`read_note`, `search_notes`, `get_updates`) check the predicate:

```
if note_meta.pin_hash for path is not null:
    if no valid unlock for path in this MCP session:
        return { kind: 'pin-protected', path }
```

MCP unlock: an `X-Kalepin-Unlock` header with a verify-token previously obtained via `/pin/verify` (one-shot, valid for the request only) lets the agent unlock for a single tool call. Rejected if not present, lock state surfaces as the sentinel.

## Frontend

- "Set PIN" / "Change PIN" / "Remove PIN" entries in note context-menu.
- PIN-prompt overlay: full-screen-modal-style on note open when locked. Shows attempt counter and lockout timer.
- Share-link viewer: PIN prompt before content renders.
- Settings → Security: "Notes with PIN" list (owner's view) for management.

## Tests

- Each route's PIN gate.
- Rate limit triggers at 5 wrong; lockout ends at 15 min.
- Owner reset clears PIN without knowing it.
- Grantee cannot reset.
- Tampered cookie (path mismatch) returns 423.
- Public share-viewer cookie clears on browser close (session cookie semantics).
- E2E paths reject PIN set with clear error.

## Dependencies

- Independent of encryption.
- Stronger UX with `add-shared-with-me-grants`: PIN gates apply equally to grantees.
- Stronger UX with `add-access-metadata`: failed PIN attempts are loggable.
