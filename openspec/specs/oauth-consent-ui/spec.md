# oauth-consent-ui Specification

## Purpose
TBD - created by archiving change mcp-oauth-server. Update Purpose after archive.
## Requirements
### Requirement: Consent screen rendered by the SPA

The system SHALL render the OAuth consent screen as part of the existing frontend SPA, not as standalone server-rendered HTML. `GET /oauth/authorize` SHALL persist the validated request and redirect the user-agent into the SPA at `/#/oauth/consent?request_id=<id>`.

#### Scenario: Authorize redirects to SPA consent route
- **WHEN** a valid `GET /oauth/authorize?...` request is processed
- **THEN** the system 302-redirects to `<base_url>/#/oauth/consent?request_id=<request_id>` where `request_id` is a one-time opaque identifier persisted server-side

#### Scenario: SPA fetches request details
- **WHEN** the SPA loads the consent route with a `request_id`
- **THEN** it calls `GET /api/oauth/authorize/:request_id` and receives `{ "client_name", "client_uri", "redirect_uri", "requested_scope": ["notes.read", ...], "user": { "email" } }` (or 404 if expired/already consumed)

### Requirement: Consent screen displays trust-relevant information

The consent screen SHALL display the client's name AND the redirect destination domain with equal visual prominence (same line or directly adjacent lines, same font weight; the redirect domain SHALL NOT be hidden in a tooltip, expandable section, or footer). It SHALL display each requested scope with a human-readable label. For unverified clients, it SHALL display a clear amber warning surrounding the client identity block.

#### Scenario: Render consent details (unverified client)
- **WHEN** the consent screen renders for an unverified client named "Claude.ai" with redirect `https://claude.ai/api/connect` requesting `notes.read notes.write`
- **THEN** the screen shows the client name and the redirect domain `claude.ai` on adjacent lines with equal prominence, an amber-bordered identity block, the disclosure "This name is provided by the requesting application — verify both the name and the destination URL match the app you intended to connect.", and a list of permissions ("Read your notes", "Edit and create notes")

#### Scenario: Render consent details (verified client)
- **WHEN** the consent screen renders for a client whose `verified=true` flag is set
- **THEN** the screen shows the client name with a "Verified" badge, the redirect domain on the next line at equal prominence, and replaces the amber unverified disclosure with a neutral muted note

#### Scenario: Show user identity
- **WHEN** the consent screen renders for an authenticated user
- **THEN** the screen shows the current user's email and a "not you?" link to switch accounts

### Requirement: User-selectable scope downgrade

The system SHALL allow the user to grant a narrower scope than the client requested. The consent UI SHALL offer the existing scope tiers (`ro`, `rc`, `rw`) up to and including the requested scope. The user SHALL NOT be able to grant scopes higher than what was requested.

#### Scenario: Downgrade rw to ro
- **WHEN** the client requested `notes.read notes.write` (rw) and the user selects "Read-only" before clicking Allow
- **THEN** the granted scope is `notes.read` only and the issued tokens carry that scope

#### Scenario: Cannot upgrade
- **WHEN** the client requested `notes.read` (ro) and the consent UI renders
- **THEN** only the "Read-only" option is enabled; "Read + Comments" and "Full access" are disabled or hidden

### Requirement: Consent decision endpoints

The system SHALL expose two SPA-facing endpoints to record the consent decision: `POST /api/oauth/authorize/:request_id/approve` and `POST /api/oauth/authorize/:request_id/deny`. Both SHALL require an authenticated user session.

#### Scenario: User approves
- **WHEN** the SPA sends `POST /api/oauth/authorize/:request_id/approve` with `{ "scope": "notes.read notes.write" }`
- **AND** the requested scope is a subset of what the request originally asked for
- **THEN** the system issues an authorization code, marks the request consumed, and returns `{ "redirect_to": "<redirect_uri>?code=<code>&state=<state>" }`

#### Scenario: User denies
- **WHEN** the SPA sends `POST /api/oauth/authorize/:request_id/deny`
- **THEN** the system marks the request consumed and returns `{ "redirect_to": "<redirect_uri>?error=access_denied&state=<state>" }`

#### Scenario: Scope not in original request
- **WHEN** the approve request supplies a scope that was not in the original `/oauth/authorize` request
- **THEN** the system rejects with 400 `{ "error": "invalid_scope" }`

### Requirement: Consent flow handles unauthenticated users

If the consent screen loads while the user has no active session, it SHALL show the existing magic-link login form inline. After successful login the user SHALL return to the same consent request without losing the `request_id`.

#### Scenario: Anonymous user lands on consent
- **WHEN** an unauthenticated user navigates to `/#/oauth/consent?request_id=<id>`
- **THEN** the SPA renders the magic-link form; on success the user is returned to the consent screen for the same `request_id`

### Requirement: Re-authorisation surfaces existing grant

If the user already has an active grant for the requesting client, the consent screen SHALL surface this fact and indicate that approving will replace the existing grant.

#### Scenario: Returning user
- **WHEN** the consent screen loads for a `(user, client)` pair that already has an active grant
- **THEN** the screen displays "You previously authorised this app on <date>. Approving will replace that authorisation."

### Requirement: Consent request expires

A pending authorization request SHALL expire 10 minutes after creation. Loading the consent screen with an expired `request_id` SHALL return a clear error.

#### Scenario: Expired request
- **WHEN** the SPA calls `GET /api/oauth/authorize/:request_id` more than 10 minutes after the request was created
- **THEN** the system returns 410 Gone and the SPA renders "This authorisation request has expired — please start again from the application that sent you here."

