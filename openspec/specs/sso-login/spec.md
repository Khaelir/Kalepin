# sso-login Specification

## Purpose
Lets users sign in through an external identity provider (Microsoft Entra ID, single tenant) as an optional alternative to the magic link, linking to Kalepin accounts by email under the domain allowlist and keeping none of the provider's tokens.
## Requirements
### Requirement: Microsoft provider enabled only by complete single-tenant configuration
The system SHALL enable the Microsoft sign-in provider only when `SSO_MICROSOFT_TENANT_ID`, `SSO_MICROSOFT_CLIENT_ID`, and a client secret (`SSO_MICROSOFT_CLIENT_SECRET_FILE` or `SSO_MICROSOFT_CLIENT_SECRET`) are all set and valid. The tenant ID and client ID MUST be GUIDs. Invalid or partial configuration SHALL disable the provider and log a warning naming the problem; it MUST NOT prevent the application from starting. When `SSO_MICROSOFT_CLIENT_SECRET_FILE` and `SSO_MICROSOFT_CLIENT_SECRET` are both set, the file SHALL take precedence and a warning SHALL be logged.

#### Scenario: No SSO configuration
- **WHEN** the backend starts with none of the `SSO_MICROSOFT_*` variables set
- **THEN** the Microsoft provider is disabled and no SSO-related warning is logged

#### Scenario: Complete configuration
- **WHEN** the backend starts with a GUID tenant ID, a GUID client ID and a readable secret file
- **THEN** the Microsoft provider is enabled and an info log states that Microsoft sign-in is enabled for that tenant

#### Scenario: Partial configuration
- **WHEN** the backend starts with `SSO_MICROSOFT_TENANT_ID` and `SSO_MICROSOFT_CLIENT_ID` set but no client secret
- **THEN** the provider is disabled, a warning names the missing variable, and the application starts normally

#### Scenario: Multi-tenant value refused
- **WHEN** `SSO_MICROSOFT_TENANT_ID` is `common`, `organizations`, `consumers`, or any non-GUID value
- **THEN** the provider is disabled and a warning states that the tenant's GUID is required and multi-tenant values are not supported

#### Scenario: Unreadable secret file
- **WHEN** `SSO_MICROSOFT_CLIENT_SECRET_FILE` points to a file that does not exist or cannot be read
- **THEN** the provider is disabled and a warning names `SSO_MICROSOFT_CLIENT_SECRET_FILE`

#### Scenario: Both secret sources set
- **WHEN** both `SSO_MICROSOFT_CLIENT_SECRET_FILE` and `SSO_MICROSOFT_CLIENT_SECRET` are set
- **THEN** the secret is read from the file and a warning states that the file takes precedence

#### Scenario: Insecure authority host refused
- **WHEN** `SSO_MICROSOFT_AUTHORITY_HOST` uses `http://` with a host other than `localhost` or `127.0.0.1`
- **THEN** the provider is disabled and a warning names `SSO_MICROSOFT_AUTHORITY_HOST`

### Requirement: Enabled providers are discoverable
The system SHALL expose `GET /api/auth/providers` without authentication, returning the list of enabled sign-in providers as `{ providers: [{ id, label }] }`.

#### Scenario: Microsoft enabled
- **WHEN** a client calls `GET /api/auth/providers` while the Microsoft provider is enabled
- **THEN** the response is `200` with `{ providers: [{ id: "microsoft", label: "Microsoft" }] }`

#### Scenario: No provider enabled
- **WHEN** a client calls `GET /api/auth/providers` while no provider is enabled
- **THEN** the response is `200` with `{ providers: [] }`

### Requirement: Starting a sign-in
`GET /api/auth/sso/{provider}/start` SHALL create a single-use sign-in request that expires after 10 minutes and holds a random `state`, a random `nonce`, a PKCE code verifier, the sanitised `returnTo`, and a hash of a browser-binding value. It SHALL set that value in an `HttpOnly`, `SameSite=Lax` cookie (also `Secure` over HTTPS) scoped to `/api/auth/sso`, and redirect to the provider's authorization endpoint. The authorization request MUST use the authorization-code flow with `code_challenge_method=S256`, `scope=openid email profile`, `prompt=select_account`, and `redirect_uri` equal to `APP_URL` (trailing slashes removed) followed by `/api/auth/sso/{provider}/callback`. It MUST NOT request `offline_access` or any API scope.

#### Scenario: Start redirects to Microsoft
- **WHEN** a browser requests `GET /api/auth/sso/microsoft/start?returnTo=/doc/Notes.md` while the provider is enabled
- **THEN** the response is a 302 to the tenant's authorization endpoint carrying `state`, `nonce`, an S256 `code_challenge`, `scope=openid email profile`, `prompt=select_account` and `redirect_uri=<APP_URL>/api/auth/sso/microsoft/callback`, and it sets the `kp_sso` cookie

#### Scenario: Unknown or disabled provider
- **WHEN** a browser requests `/api/auth/sso/microsoft/start` while the Microsoft provider is disabled, or `/api/auth/sso/unknown/start`
- **THEN** the response is `404`

#### Scenario: Off-origin returnTo
- **WHEN** `returnTo` is `//evil.example/` or any value that `safeReturnPath` rejects
- **THEN** the stored return path is `/`

#### Scenario: Start rate limited
- **WHEN** a single IP exceeds 20 start requests within one minute
- **THEN** further start requests are rejected with `429` until the window passes

#### Scenario: Provider metadata unreachable
- **WHEN** the provider's discovery document cannot be fetched at start time
- **THEN** the browser is redirected back into the SPA with `sso_error=unavailable` and no sign-in request is left usable

### Requirement: Completing a sign-in
`GET /api/auth/sso/{provider}/callback` SHALL accept the callback only when its `state` matches an unexpired, unused sign-in request for the same provider, and the `kp_sso` cookie hashes to that request's stored binding. The request SHALL be marked used before the authorization code is exchanged. The system SHALL exchange the code with the stored PKCE verifier, validate the ID token (signature against the provider's published keys, issuer, audience, expiry, and nonce), and clear the `kp_sso` cookie. Every outcome SHALL be a redirect into the SPA; failures carry an `sso_error` code and never the provider's raw error text.

#### Scenario: Valid callback
- **WHEN** the callback arrives with a known, unexpired, unused `state`, a matching cookie and a code the provider accepts
- **THEN** the system validates the ID token and continues to account resolution

#### Scenario: Replayed state
- **WHEN** a callback arrives for a `state` whose request was already used
- **THEN** no session is issued and the browser is redirected with `sso_error=expired`

#### Scenario: Expired request
- **WHEN** a callback arrives more than 10 minutes after its request was created
- **THEN** no session is issued and the browser is redirected with `sso_error=expired`

#### Scenario: Cookie missing or mismatched
- **WHEN** a callback arrives with a valid `state` but without the `kp_sso` cookie, or with a cookie whose hash differs from the stored binding
- **THEN** no session is issued, the request is consumed, and the browser is redirected with `sso_error=expired`

#### Scenario: User cancels at the provider
- **WHEN** the provider redirects back with `error=access_denied`
- **THEN** no session is issued and the browser is redirected with `sso_error=cancelled`

#### Scenario: Code exchange fails
- **WHEN** the provider rejects the code exchange (for example an invalid or expired client secret)
- **THEN** no session is issued, the provider's error code is logged, and the browser is redirected with `sso_error=provider_error`

#### Scenario: ID token fails validation
- **WHEN** the ID token's signature, issuer, audience, expiry or nonce is invalid
- **THEN** no session is issued and the browser is redirected with `sso_error=provider_error`

### Requirement: Microsoft identities restricted to the configured tenant
The Microsoft provider SHALL use the authority `{SSO_MICROSOFT_AUTHORITY_HOST or https://login.microsoftonline.com}/{SSO_MICROSOFT_TENANT_ID}/v2.0`, and SHALL reject any ID token whose `tid` claim differs from the configured tenant ID (compared case-insensitively).

#### Scenario: Token from the configured tenant
- **WHEN** the validated ID token carries `tid` equal to `SSO_MICROSOFT_TENANT_ID`
- **THEN** the identity is accepted and passed to account resolution with emails `[email, preferred_username]` (absent claims omitted), subject `oid`, and display name `name`

#### Scenario: Token from another tenant
- **WHEN** the validated ID token carries a `tid` different from `SSO_MICROSOFT_TENANT_ID`
- **THEN** no session is issued and the browser is redirected with `sso_error=wrong_tenant`

### Requirement: Accounts linked by email
The system SHALL resolve an external identity to a Kalepin user by email. It SHALL canonicalise each email candidate from the provider in order (discarding values that are not valid emails), keep only those allowed by `DOMAIN_ALLOWLIST`, and remove duplicates. It SHALL then look up existing users by those addresses: exactly one match signs in that user; no match creates a user with the first remaining candidate; more than one distinct match refuses the sign-in. If no candidate remains after filtering, the sign-in SHALL be refused as a disallowed domain.

#### Scenario: Existing user matched by email claim
- **WHEN** the identity's `email` is `alice@company.com` and a user `alice@company.com` exists
- **THEN** the session is issued for that existing user

#### Scenario: Existing user matched by sign-in name only
- **WHEN** the identity's `email` is `a.smith@company.com`, its `preferred_username` is `alice@company.com`, and only `alice@company.com` exists as a user
- **THEN** the session is issued for `alice@company.com`

#### Scenario: New user created
- **WHEN** no existing user matches any allowlisted candidate
- **THEN** a user is created with the first candidate (the `email` claim when present, otherwise `preferred_username`), their personal folder is ensured, and the session is issued for that user

#### Scenario: Candidates match two different users
- **WHEN** the `email` claim matches user A and `preferred_username` matches a different user B
- **THEN** no session is issued, a warning naming both user IDs is logged, and the browser is redirected with `sso_error=ambiguous_account`

#### Scenario: Case and whitespace differences
- **WHEN** the identity's `email` is ` Alice@Company.COM ` and a user `alice@company.com` exists
- **THEN** the session is issued for `alice@company.com`

#### Scenario: Non-email sign-in name ignored
- **WHEN** `preferred_username` is not a valid email address and `email` is `alice@company.com`
- **THEN** resolution proceeds with `alice@company.com` alone

#### Scenario: Domain not allowed
- **WHEN** `DOMAIN_ALLOWLIST` is `company.com` and every candidate address is on another domain
- **THEN** no user is created, no session is issued, and the browser is redirected with `sso_error=domain_not_allowed`

### Requirement: Session issued and return path honoured
On successful resolution the system SHALL ensure the user's personal folder, issue the same session JWT as the magic-link flow, and redirect using the shared post-login redirect, so the user lands on the `returnTo` captured at start.

#### Scenario: Return to the requested document
- **WHEN** a sign-in started with `returnTo=/doc/Notes.md` completes successfully
- **THEN** the browser is redirected to `/doc/Notes.md?token=<session JWT>`

#### Scenario: Error returns to the requested page
- **WHEN** a sign-in started with `returnTo=/#/oauth/consent?request_id=abc` fails with `domain_not_allowed`
- **THEN** the browser is redirected to `/?sso_error=domain_not_allowed#/oauth/consent?request_id=abc`

### Requirement: Provider tokens are not retained
The system SHALL use the provider's tokens only to establish the user's identity during the callback. It MUST NOT persist access tokens, refresh tokens or ID tokens, and MUST NOT call provider APIs beyond OIDC discovery, the JWKS and the token endpoint.

#### Scenario: Nothing stored after sign-in
- **WHEN** a Microsoft sign-in completes
- **THEN** no access, refresh or ID token from Microsoft exists in the database or logs

### Requirement: External identities recorded
The system SHALL record each successful external sign-in in `user_identities`, keyed uniquely by (provider, issuer, subject), with the linked user, the email used at link time, and the last sign-in time. Identity records SHALL NOT influence account resolution. When a known identity resolves to a different user than the one it is recorded against, the system SHALL log a warning and re-point the record to the new user.

#### Scenario: First sign-in records the identity
- **WHEN** a Microsoft identity with `oid` X signs in for the first time and resolves to user 12
- **THEN** a `user_identities` row (microsoft, issuer, X) → user 12 is created with `emailAtLink` and `lastLoginAt` set

#### Scenario: Repeat sign-in updates last login
- **WHEN** the same identity signs in again and resolves to the same user
- **THEN** only `lastLoginAt` is updated

#### Scenario: Identity resolves to a different user
- **WHEN** the identity recorded against user 12 now resolves to user 30 (for example after an email change)
- **THEN** a warning is logged and the record is re-pointed to user 30 with the new `emailAtLink`; the sign-in proceeds as user 30

### Requirement: Display name filled from the provider
When the provider supplies a non-empty display name and the resolved user has none, the system SHALL set the user's display name to it, trimmed and limited to 200 characters. It MUST NOT overwrite an existing display name.

#### Scenario: Empty display name filled
- **WHEN** a user without a display name signs in with Microsoft and the ID token's `name` is `Alice Smith`
- **THEN** the user's display name becomes `Alice Smith`

#### Scenario: Existing display name kept
- **WHEN** a user whose display name is `Ali` signs in with Microsoft and the ID token's `name` is `Alice Smith`
- **THEN** the user's display name remains `Ali`

### Requirement: Login page offers enabled providers
The login page SHALL fetch the enabled providers and, for each one, render a "Sign in with {label}" button above the magic-link form, separated by an "or" divider. The magic-link form SHALL always remain available. Clicking a provider button SHALL perform a full-page navigation to that provider's start endpoint with the current path, query and fragment as `returnTo`. When the URL carries `sso_error`, the page SHALL display the message for that code and remove the parameter from the URL.

#### Scenario: Provider enabled
- **WHEN** an unauthenticated user opens Kalepin while the Microsoft provider is enabled
- **THEN** the login page shows "Sign in with Microsoft" above the magic-link form

#### Scenario: No provider enabled
- **WHEN** an unauthenticated user opens Kalepin while no provider is enabled, or the providers request fails
- **THEN** the login page shows only the magic-link form

#### Scenario: Error displayed
- **WHEN** the login page loads with `?sso_error=domain_not_allowed`
- **THEN** the page shows "Email domain not allowed" and the URL no longer contains `sso_error`

#### Scenario: Unknown error code
- **WHEN** the login page loads with an `sso_error` value it does not recognise
- **THEN** the page shows the generic Microsoft sign-in failure message

### Requirement: Expired sign-in requests are cleaned up
The system SHALL periodically delete sign-in requests that are used, or that expired more than one hour earlier.

#### Scenario: Sweep removes stale rows
- **WHEN** the cleanup runs and a request expired two hours ago
- **THEN** that request no longer exists in `sso_login_requests`

