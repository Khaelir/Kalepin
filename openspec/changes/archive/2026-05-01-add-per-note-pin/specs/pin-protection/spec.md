# Spec delta: pin-protection (NEW)

## ADDED Requirements

### Requirement: Owner sets, changes, or removes a per-note PIN

The system SHALL provide `POST /api/notes/:path/pin` (set/change) and `DELETE /api/notes/:path/pin` (remove). Both SHALL require the requester to own the path. The remove endpoint SHALL succeed without requiring the current PIN.

#### Scenario: Owner sets a PIN
- **WHEN** Alice POSTs `{ "pin": "abcd1234" }` to `/api/notes/_users%2Falice%2Ffoo.md/pin`
- **THEN** the response is 204; `note_meta.pin_hash` is non-null

#### Scenario: Owner removes a PIN without entering it
- **GIVEN** a PIN is set on Alice's note
- **WHEN** Alice DELETEs the PIN endpoint
- **THEN** `note_meta.pin_hash` is null

### Requirement: Reads, writes, and comments on a PIN-locked path require an unlock cookie

When `note_meta.pin_hash` is non-null for a path, every authenticated read/write/comment request SHALL require a valid unlock cookie scoped to that path; otherwise the response is 423 Locked.

#### Scenario: Read without unlock returns 423
- **GIVEN** a PIN is set on Alice's `_users/alice/foo.md`
- **WHEN** Alice calls `GET /api/files/read?path=_users/alice/foo.md` without an unlock cookie
- **THEN** the response is 423

#### Scenario: Read with valid unlock returns 200
- **GIVEN** Alice has POSTed `/pin/verify` with the correct PIN
- **WHEN** Alice retries the read
- **THEN** the response is 200 with content

### Requirement: Verify endpoint issues path-scoped unlock cookies

`POST /api/notes/:path/pin/verify` SHALL accept `{ pin }` and, on match, set an HttpOnly, Secure, SameSite=Lax cookie containing a signed JWT scoped to the path. TTL SHALL be 24 hours for owners and grantees, and session-only for public-share viewers.

#### Scenario: Owner verify
- **WHEN** Alice POSTs the correct PIN
- **THEN** the response is 200 with `Set-Cookie: kalepin_pin_unlock_<hash>; Max-Age=86400`

### Requirement: Rate-limit on wrong PIN attempts

After 5 wrong attempts within a 15-minute rolling window for a (path, viewer) pair, the system SHALL refuse further attempts for 15 minutes with a 423 response containing `lockoutUntil`.

#### Scenario: Lockout triggers at 5 attempts
- **WHEN** the same viewer submits 5 wrong PINs to the same path within 15 min
- **THEN** the 6th attempt returns 423 with `lockoutUntil`

#### Scenario: Lockout ends after 15 min
- **GIVEN** a viewer is locked out at `T`
- **WHEN** they re-attempt at `T + 16 min`
- **THEN** the request is processed (and increments the next window's counter on failure)

### Requirement: Grantees can verify but cannot remove the PIN

A grantee with an active grant on a PIN-locked path SHALL be able to verify and obtain an unlock cookie. They SHALL NOT be able to call DELETE on the PIN endpoint.

#### Scenario: Grantee unlocks
- **GIVEN** Bob has a read grant on Alice's PIN-locked note
- **WHEN** Bob POSTs the correct PIN to verify
- **THEN** Bob receives an unlock cookie and can read

#### Scenario: Grantee cannot remove
- **WHEN** Bob calls DELETE on the PIN endpoint
- **THEN** the response is 403

### Requirement: Public share viewers receive session-scoped unlock cookies

When a public-share viewer (unauthenticated or authenticated) verifies the PIN at `/share/:code`, the unlock cookie SHALL have no `Max-Age` (session-only).

#### Scenario: Cookie clears on browser close
- **GIVEN** an anonymous viewer unlocked a share-page PIN
- **WHEN** they close and reopen the browser
- **THEN** the cookie is gone and they must re-enter the PIN

### Requirement: MCP read tools return a sentinel for PIN-locked paths

MCP tools that read content (`read_note`, `search_notes`, `get_updates`) SHALL detect PIN-locked paths and return `{ kind: 'pin-protected', path }` instead of plaintext, unless the request includes a valid `X-Kalepin-Unlock` header for the path.

#### Scenario: MCP read without unlock
- **GIVEN** a PIN is set on Alice's note
- **WHEN** Alice's MCP-connected agent calls `read_note` for that path
- **THEN** the response is `{ kind: 'pin-protected', path }`

### Requirement: Setting a PIN on E2E paths is rejected

The PIN service SHALL reject `POST /pin` for paths where `isE2EEncrypted(path)` returns true, with a 400 response and a message clarifying the difference.

#### Scenario: Stage-2 path rejected
- **GIVEN** stub `isE2EEncrypted('_users/alice/_secure/journal.md') === true`
- **WHEN** Alice POSTs a PIN for that path
- **THEN** the response is 400 with a message naming `_secure/`
