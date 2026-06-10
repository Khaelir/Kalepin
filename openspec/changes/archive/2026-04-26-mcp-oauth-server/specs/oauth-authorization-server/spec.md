## ADDED Requirements

### Requirement: Dynamic Client Registration

The system SHALL implement RFC 7591 Dynamic Client Registration so that any well-formed registration request mints a new OAuth client record. Registration SHALL NOT require pre-approval. The endpoint SHALL be rate-limited per source IP.

#### Scenario: Successful registration
- **WHEN** a client sends `POST /oauth/register` with a JSON body containing at least `client_name` and one or more `redirect_uris`
- **THEN** the system stores the client record and returns `{ "client_id": "<id>", "client_id_issued_at": <unix>, "redirect_uris": [...], "client_name": "...", "token_endpoint_auth_method": "none" }` with 201 Created

#### Scenario: Public client (no secret)
- **WHEN** a registration request includes `token_endpoint_auth_method: "none"` (PKCE-based public client)
- **THEN** the system mints a client without a `client_secret` and the response omits `client_secret`

#### Scenario: Malformed registration
- **WHEN** a registration request omits `redirect_uris` or supplies an invalid URI (non-`https`, fragment, etc.)
- **THEN** the system returns 400 with `{ "error": "invalid_redirect_uri" }`

#### Scenario: Rate-limited
- **WHEN** a single source IP sends more than 10 registration requests in 60 seconds
- **THEN** the system returns 429 Too Many Requests

### Requirement: Authorization Code flow with PKCE

The system SHALL support the OAuth 2.1 authorization code grant with mandatory PKCE (S256). It SHALL reject requests that omit `code_challenge` or use `plain` as the challenge method.

#### Scenario: Initiate authorization
- **WHEN** a client sends `GET /oauth/authorize?response_type=code&client_id=<id>&redirect_uri=<uri>&scope=<scopes>&state=<state>&code_challenge=<challenge>&code_challenge_method=S256`
- **THEN** the system verifies the `client_id` exists, verifies `redirect_uri` exactly matches a URI registered to that client, persists a pending authorization request, and redirects the user to the consent screen carrying a one-time `request_id`

#### Scenario: redirect_uri mismatch
- **WHEN** the supplied `redirect_uri` does not exactly match one of the client's registered URIs
- **THEN** the system rejects the request with 400 and does NOT redirect (no open-redirect surface)

#### Scenario: Missing PKCE
- **WHEN** an authorization request omits `code_challenge`
- **THEN** the system rejects with `error=invalid_request&error_description=PKCE+required` redirected to `redirect_uri` (parameters validated first)

#### Scenario: Plain PKCE rejected
- **WHEN** an authorization request supplies `code_challenge_method=plain`
- **THEN** the system rejects with `error=invalid_request&error_description=Only+S256+supported`

### Requirement: Authorization code issuance after consent

The system SHALL issue a single-use authorization code after the user completes consent. The code SHALL bind the user, client, granted scope, redirect_uri, and PKCE challenge. The code SHALL expire within 60 seconds.

#### Scenario: Code issued
- **WHEN** the user approves consent for an authorization request
- **THEN** the system generates a 32-byte random code, stores it with `(user_id, client_id, scope, redirect_uri, code_challenge, expires_at)`, and 302-redirects the user-agent to `<redirect_uri>?code=<code>&state=<state>`

#### Scenario: Code expires
- **WHEN** a token exchange uses an authorization code more than 60 seconds after issuance
- **THEN** the system returns `{ "error": "invalid_grant" }` with 400

#### Scenario: Code is single-use
- **WHEN** a token exchange successfully uses an authorization code
- **THEN** any subsequent use of the same code returns `{ "error": "invalid_grant" }` AND the system revokes any tokens that may have been issued from that code

### Requirement: Token endpoint exchanges code or refresh for tokens

The system SHALL implement `POST /oauth/token` supporting `grant_type=authorization_code` and `grant_type=refresh_token`. The endpoint SHALL accept `application/x-www-form-urlencoded`. It SHALL be rate-limited per client_id.

#### Scenario: Authorization code exchange
- **WHEN** a client sends `POST /oauth/token` with `grant_type=authorization_code&code=<code>&redirect_uri=<uri>&client_id=<id>&code_verifier=<verifier>`
- **AND** the verifier's S256 hash equals the stored `code_challenge`
- **THEN** the system returns `{ "access_token": "kpoa_at_...", "refresh_token": "kpoa_rt_...", "token_type": "Bearer", "expires_in": 3600, "scope": "<granted scopes>" }`

#### Scenario: PKCE verification failure
- **WHEN** the supplied `code_verifier` does not hash to the stored `code_challenge`
- **THEN** the system returns `{ "error": "invalid_grant" }` with 400 and revokes the authorization code

#### Scenario: redirect_uri mismatch on token exchange
- **WHEN** the `redirect_uri` parameter at `/oauth/token` differs from the one used at `/oauth/authorize`
- **THEN** the system returns `{ "error": "invalid_grant" }` with 400

### Requirement: Refresh token rotation with replay-chain revocation

The system SHALL rotate refresh tokens on every successful refresh. Each refresh token SHALL be single-use; on use it SHALL be marked consumed and replaced by a new refresh token. If a consumed refresh token is presented again *outside* the leeway window defined below, the system SHALL revoke the entire token chain (all descendants and the active access token).

#### Scenario: Successful refresh
- **WHEN** a client sends `POST /oauth/token` with `grant_type=refresh_token&refresh_token=<rt>&client_id=<id>`
- **AND** the refresh token is unconsumed and not expired
- **THEN** the system returns a new `access_token` and a new `refresh_token`, marks the old refresh token consumed with `replaced_by_id` set to the new token's id

#### Scenario: Replay detected (outside leeway)
- **WHEN** a client presents a refresh token that has been consumed more than the leeway window ago
- **THEN** the system returns `{ "error": "invalid_grant" }` with 400 AND revokes every refresh token in the chain (recursive on `replaced_by_id`) AND revokes the access token currently issued for the chain

#### Scenario: Refresh of revoked grant
- **WHEN** a client presents a refresh token whose underlying grant has been revoked (via `/oauth/revoke` or chain revocation)
- **THEN** the system returns `{ "error": "invalid_grant" }` with 400

### Requirement: Refresh leeway window for retries

The system SHALL accept presentation of a consumed refresh token for up to 30 seconds after consumption WITHOUT revoking the chain. Within the leeway window, the server SHALL re-emit the same `(access_token, refresh_token)` pair that was issued by the original rotation rather than generate new tokens.

#### Scenario: Network retry within leeway
- **WHEN** a client sends two `/oauth/token` refresh calls with the same refresh token within 30 seconds
- **THEN** the second call returns the same access/refresh pair as the first; no chain revocation occurs

#### Scenario: Replay outside leeway
- **WHEN** a client presents a consumed refresh token more than 30 seconds after it was rotated
- **THEN** replay-chain revocation fires as defined in "Refresh token rotation"

### Requirement: Per-grant refresh serialisation

The system SHALL serialise concurrent refresh attempts on the same grant. Two refresh calls arriving in parallel for the same grant SHALL NOT both succeed with distinct token chains.

#### Scenario: Parallel refresh on the same grant
- **WHEN** two `/oauth/token` refresh calls for the same grant arrive simultaneously
- **THEN** they execute serially under a per-grant lock; the second observes the rotation performed by the first and either re-emits via the leeway window OR fails with `invalid_grant` if its presented refresh token has already been consumed

### Requirement: Refresh tokens are sliding-window with absolute cap

A refresh token SHALL be issued with `expires_at = now + 30 days`. Each successful rotation SHALL reset `expires_at` of the new refresh token to `now + 30 days`. The grant SHALL carry `absolute_expires_at = grant.created_at + 365 days` set at the *initial* grant issuance; rotations SHALL NOT push past this absolute cap. Once the absolute cap is reached, the next refresh SHALL fail with `invalid_grant`.

#### Scenario: Sliding window extends with use
- **WHEN** a client refreshes 25 days after the initial grant
- **THEN** the new refresh token's `expires_at` is `now + 30 days` (i.e. 55 days after initial grant)

#### Scenario: Idle expiry
- **WHEN** a client does not refresh for more than 30 days
- **THEN** the refresh token expires; the next attempt to use it returns `invalid_grant`

#### Scenario: Absolute cap enforced
- **WHEN** a client attempts to refresh after `grant.absolute_expires_at` has passed
- **THEN** the system returns `invalid_grant` regardless of the refresh token's own `expires_at`

### Requirement: Revocation endpoint

The system SHALL implement RFC 7009 token revocation at `POST /oauth/revoke`. Revocation SHALL invalidate the token immediately and, when the revoked token is a refresh token, the entire chain.

#### Scenario: Revoke access token
- **WHEN** a client sends `POST /oauth/revoke` with `token=<access_token>&token_type_hint=access_token`
- **THEN** the system marks the access token revoked and returns 200 OK

#### Scenario: Revoke refresh token
- **WHEN** a client sends `POST /oauth/revoke` with `token=<refresh_token>&token_type_hint=refresh_token`
- **THEN** the system revokes the refresh token chain and any access token tied to it, and returns 200 OK

#### Scenario: Unknown token
- **WHEN** the supplied token does not match any record
- **THEN** the system returns 200 OK (per RFC 7009; do not leak token validity)

### Requirement: Access token storage and lifetime

The system SHALL store access tokens as SHA-256 hashes with prefix `kpoa_at_` on the raw token. Access tokens SHALL expire 3600 seconds after issuance. Each access token SHALL link to (user, client, scope, refresh_chain_id).

#### Scenario: Token format
- **WHEN** an access token is issued
- **THEN** the raw token has the form `kpoa_at_<43 base64url chars>` and the database stores only the SHA-256 hash

#### Scenario: Expiry enforcement
- **WHEN** a request presents an access token whose `expires_at` is in the past
- **THEN** authentication fails with 401

### Requirement: Device-aware uniqueness for grants

The system SHALL maintain at most one active grant per `(user_id, client_id, device_label)` triple, where `device_label` is derived from the registering client's DCR metadata (`software_id` and optionally `software_version`) and may be NULL when the client supplies no such metadata. Re-authorising an existing triple SHALL revoke the previous grant's tokens before issuing new ones.

#### Scenario: Same client_id, different devices coexist
- **WHEN** the same `client_id` registers with `software_id=claude-web` and later with `software_id=claude-desktop` for the same user
- **THEN** both grants coexist, listed separately in the user's Connections, and revoking one does not affect the other

#### Scenario: Re-authorisation replaces same triple
- **WHEN** a user completes consent for a `(client_id, device_label)` triple they have already authorised
- **THEN** the system revokes all access and refresh tokens from the previous grant and issues a new chain

#### Scenario: NULL device_label falls back to (user_id, client_id)
- **WHEN** the client supplies no `software_id` and the user re-authorises the same `client_id`
- **THEN** the system replaces the previous grant (single grant per `(user_id, client_id)` when `device_label` is NULL on both sides)

### Requirement: Verified-client flag exposed through metadata

The system SHALL maintain a static allow-list of known clients keyed by `software_id`. When DCR registration's `software_id` matches the allow-list, the resulting client row SHALL be flagged `verified=true`. The flag SHALL be exposed in the consent screen's request-detail response so the UI can render a "Verified" badge.

#### Scenario: Known software_id is verified
- **WHEN** DCR registration includes `software_id=anthropic-claude-ai` (or another entry on the static allow-list)
- **THEN** the stored client record has `verified=true` and `GET /api/oauth/authorize/:request_id` includes `client.verified: true` in its response

#### Scenario: Unknown software_id is not verified
- **WHEN** DCR registration includes any `software_id` not on the allow-list (or omits it entirely)
- **THEN** the client record has `verified=false`

### Requirement: Admin scope is not OAuth-grantable

The system SHALL NOT allow OAuth tokens to be issued with `admin` scope, regardless of what the client requested or what the user attempts to grant.

#### Scenario: Client requests admin scope
- **WHEN** an authorization request includes `scope=notes.admin`
- **THEN** the system rejects with `error=invalid_scope` and aborts the flow

### Requirement: Default and unknown scope policies

The system SHALL apply explicit policies for the `scope` parameter at `/oauth/authorize`:
- Missing or empty `scope` SHALL default to `notes.read`
- Any scope value not in the supported set (`notes.read`, `notes.comment`, `notes.write`) SHALL cause the request to be rejected with `error=invalid_scope`

#### Scenario: Missing scope defaults to read-only
- **WHEN** an authorization request omits the `scope` parameter
- **THEN** the system treats the requested scope as `notes.read` and the consent screen renders accordingly

#### Scenario: Unknown scope rejected
- **WHEN** an authorization request includes `scope=notes.delete` (or any other value not in the supported set)
- **THEN** the system rejects with `error=invalid_scope`

### Requirement: DCR client garbage collection

The system SHALL run a scheduled job that deletes `oauth_clients` records satisfying ALL of: `created_at` older than 30 days, no `oauth_grants` ever associated (active or revoked), no `oauth_authorization_requests` in the last 30 days. The job SHALL log the count of deleted clients.

#### Scenario: Stale unused client cleaned up
- **WHEN** a client was registered 31 days ago, never produced a grant, and has had no authorization requests in 30 days
- **THEN** the next GC run deletes the client record

#### Scenario: Client with grants preserved
- **WHEN** a client has any grant (even revoked) or any recent authorization request
- **THEN** the GC run leaves it untouched
