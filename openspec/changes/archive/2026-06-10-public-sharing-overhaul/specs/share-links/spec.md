# Spec delta: share-links (MODIFIED)

## ADDED Requirements

### Requirement: Recipient URL is path-free

The clipboard / notification copy URL emitted for a share-link SHALL be of the form `/s/<code>` with no cosmetic path. In-app navigation MAY use `/s/<code>/<cosmetic>` for stale-cosmetic recovery; the legacy `/d/<code>` and `/d/<code>/<cosmetic>` prefixes SHALL continue to resolve.

#### Scenario: Clipboard copy emits path-free URL
- **GIVEN** Alice has minted a share-link for `Notes/Alpha/Beta.md` with code `abc12345`
- **WHEN** Alice triggers "Copy public link" (button or `Cmd-Shift-C`)
- **THEN** the clipboard contains `<origin>/s/abc12345` with no cosmetic suffix

#### Scenario: Legacy `/d/` URL still resolves
- **GIVEN** a previously-shared URL `/d/abc12345/Notes-Alpha-Beta`
- **WHEN** any client navigates to it
- **THEN** the system resolves the code identically to `/s/abc12345`

### Requirement: Mint requires write permission

`POST /api/share-links` SHALL require write permission on the underlying path. Read-only grantees SHALL receive `403 Forbidden`.

#### Scenario: Read-only grantee cannot mint
- **GIVEN** Bob has a read-only grant on `Notes/foo.md`
- **WHEN** Bob POSTs `/api/share-links` for that path
- **THEN** the response is `403`

#### Scenario: Write grantee can mint
- **GIVEN** Bob has a write grant on `Notes/foo.md`
- **WHEN** Bob POSTs `/api/share-links` for that path
- **THEN** the response is `201` and a code is returned

### Requirement: Revoke is restricted to creator or admin

`DELETE /api/share-links/:code` SHALL succeed only when the requester's email matches the row's `created_by_email` (case-insensitive) or the requester is an admin. For legacy rows where `created_by_email IS NULL`, the previous owner-or-admin gate SHALL apply.

#### Scenario: Creator can revoke
- **GIVEN** Alice minted code `abc12345`
- **WHEN** Alice DELETEs `/api/share-links/abc12345`
- **THEN** `revoked_at` is set and subsequent resolves return `410`

#### Scenario: Non-creator cannot revoke
- **GIVEN** Alice minted code `abc12345`; Bob has read-or-write access to the path but did not mint
- **WHEN** Bob DELETEs `/api/share-links/abc12345`
- **THEN** the response is `403`

#### Scenario: Admin can revoke any code
- **WHEN** an admin DELETEs a code created by another user
- **THEN** the response is `200` and the row is revoked

#### Scenario: Legacy null-creator row revocable by owner
- **GIVEN** a legacy auto-minted row with `created_by_email IS NULL`
- **WHEN** the path owner DELETEs the code
- **THEN** the response is `200` and the row is revoked

### Requirement: byPath surfaces creator email

`GET /api/share-links/by-path?path=...` SHALL include `created_by_email` in the metadata blob (nullable for legacy rows).

#### Scenario: Creator email returned
- **GIVEN** Alice minted a code for `Notes/foo.md`
- **WHEN** any authorized requester GETs `/api/share-links/by-path?path=Notes/foo.md`
- **THEN** the response includes `created_by_email: "alice@…"`

### Requirement: Anonymous viewers can resolve without authentication

`GET /api/share-links/resolve/:code` SHALL accept anonymous requests. The response SHALL include the path, `sharedByEmail` (the link's `created_by_email`), and `allowGuestComments`. When the underlying note has no PIN, the response SHALL also include a scoped `accessToken` and `accessTokenExpiresAt`. When a PIN is set and not yet satisfied for this caller, the response SHALL include `requiresPin: true` and SHALL NOT include `accessToken`.

#### Scenario: Anonymous resolve, no PIN
- **GIVEN** Alice's code `abc12345` resolves to a note with no PIN
- **WHEN** an anonymous client GETs `/api/share-links/resolve/abc12345`
- **THEN** the response includes `path`, `sharedByEmail`, `allowGuestComments`, `accessToken`, `accessTokenExpiresAt`, and `requiresPin: false`

#### Scenario: Anonymous resolve, PIN required
- **GIVEN** the underlying note has a PIN and the caller has not unlocked it
- **WHEN** an anonymous client resolves the code
- **THEN** the response includes `requiresPin: true` and OMITS `accessToken`

#### Scenario: Anonymous resolve of revoked code
- **GIVEN** the code is revoked
- **WHEN** an anonymous client resolves it
- **THEN** the response is `410`

### Requirement: Anonymous content endpoint

`GET /api/share-links/:code/content` SHALL return the rewritten markdown body for an anonymous viewer when the request carries `Authorization: ShareLink <token>` with a valid `(code, path)` scoped token. The endpoint SHALL re-check link health on every request, refuse on path drift, apply the PIN gate, and record an access-log row with `viewer=anonymous`.

#### Scenario: Valid token returns content
- **GIVEN** an anonymous client holds a valid scoped token issued by `resolve`
- **WHEN** it GETs `/api/share-links/abc12345/content` with `Authorization: ShareLink <token>`
- **THEN** the response is `200` with rewritten markdown

#### Scenario: Token bound to a different code is rejected
- **GIVEN** a token issued for code `abc` is presented at `/api/share-links/xyz/content`
- **THEN** the response is `401`

#### Scenario: Revoked link blocks content fetch
- **GIVEN** the link was revoked after a token was minted
- **WHEN** the client fetches content with the still-valid token
- **THEN** the response is `410`

### Requirement: Anonymous PIN unlock

`POST /api/share-links/:code/pin/verify` SHALL accept an unauthenticated PIN submission for a PIN-protected share-link. On success, the response SHALL include a fresh scoped `accessToken` for the same code and path. The unlock SHALL be keyed off a synthetic `anonymous-<code>` identity so it does not leak to other share-links or to authenticated users.

#### Scenario: Correct PIN issues access token
- **GIVEN** the note has a PIN and the guest knows it
- **WHEN** the guest POSTs the correct PIN
- **THEN** the response is `200` with `accessToken` and `accessTokenExpiresAt`

#### Scenario: Wrong PIN rejected
- **WHEN** the guest POSTs an incorrect PIN
- **THEN** the response is `401`

### Requirement: Asset references are rewritten and gated

For an anonymous viewer, the markdown body returned by `/content` SHALL have its `_attachments/<name>` references (markdown image, markdown link, and HTML `<img>` shapes) rewritten to `/api/share-links/:code/asset?name=<name>&st=<token>`, where `<token>` is a per-asset scoped token bound to `(code, name, sharedNotePath)`. References whose name contains traversal characters SHALL be blanked (empty `src`).

`GET /api/share-links/:code/asset` SHALL serve the asset only when the `st` query param verifies as a token bound to that asset and code. The endpoint SHALL re-check link health on every fetch.

#### Scenario: Valid token serves asset
- **GIVEN** the markdown contained `![](_attachments/diagram.png)` and was rewritten
- **WHEN** the guest browser fetches the rewritten URL
- **THEN** the response is `200` with the image bytes

#### Scenario: Asset token reused for a different name is rejected
- **WHEN** a token signed for `diagram.png` is presented with `?name=secrets.png`
- **THEN** the response is `401`

#### Scenario: Traversal name is blanked
- **GIVEN** the markdown contained `![](_attachments/../../etc/passwd)`
- **WHEN** the rewriter processes it
- **THEN** the resulting `src` is empty (no fetchable URL)

#### Scenario: Revoked link blocks asset fetch
- **GIVEN** the link was revoked after the page rendered
- **WHEN** the guest browser fetches an asset
- **THEN** the response is `410`

### Requirement: Anonymous endpoints enforce per-IP rate limits

Anonymous endpoints under `/api/share-links` SHALL enforce per-IP sliding-window rate limits:

| Endpoint | Limit |
|---|---|
| `GET /resolve/:code` | 30 / min |
| `GET /:code/content` | 60 / min |
| `GET /:code/asset` | 240 / min |
| `POST /:code/pin/verify` | 10 / min |
| `POST /:code/comments` | 5 / min |

Authenticated requests SHALL bypass these limits. The IP source SHALL honour `X-Forwarded-For` when present.

#### Scenario: Resolve rate limit
- **GIVEN** an anonymous client has made 30 resolves in the past 60 seconds
- **WHEN** it makes a 31st resolve
- **THEN** the response is `429`

#### Scenario: Authenticated bypass
- **GIVEN** an authenticated user makes 100 resolves in 60 seconds
- **WHEN** the 101st request fires
- **THEN** the response is not rate-limited by `AnonymousRateLimitGuard`

### Requirement: allow_guest_comments flag

`short_links` SHALL include a boolean `allow_guest_comments` column (default `false`). `POST /api/share-links` SHALL accept the flag at mint time. `PATCH /api/share-links/:code` SHALL allow the creator or an admin to toggle the flag on an existing row; only `allow_guest_comments` is mutable.

#### Scenario: Mint with flag
- **WHEN** Alice POSTs `/api/share-links` with `allow_guest_comments: true`
- **THEN** the row's `allowGuestComments` is `true`

#### Scenario: Patch toggles flag
- **GIVEN** an active code with the flag off
- **WHEN** the creator PATCHes `/api/share-links/<code>` with `allow_guest_comments: true`
- **THEN** the response is `200` and subsequent `byPath` reflects the new flag

#### Scenario: Non-creator cannot patch
- **WHEN** a non-creator non-admin PATCHes the flag
- **THEN** the response is `403`

### Requirement: Anonymous guest comment endpoint

`POST /api/share-links/:code/comments` SHALL accept a guest comment (new thread or reply) when the request carries a valid scoped token AND the link's `allowGuestComments` is `true`. The body SHALL include `authorEmail`, `authorName`, and `text`. The server SHALL validate email syntax and length caps. Comments persisted via this endpoint SHALL be marked `authorVerified=false`.

#### Scenario: Flag off rejects guest comment
- **GIVEN** `allowGuestComments` is `false`
- **WHEN** a guest POSTs a comment
- **THEN** the response is `403`

#### Scenario: Valid guest comment accepted
- **GIVEN** the flag is on and the scoped token is valid
- **WHEN** a guest POSTs `{ authorEmail, authorName, text }`
- **THEN** the response is `201` and the comment persists with `authorVerified=false`

#### Scenario: Reply shape accepted
- **WHEN** the body includes `threadId` and `blockId` for an existing thread
- **THEN** the comment is appended to that thread with `authorVerified=false`
