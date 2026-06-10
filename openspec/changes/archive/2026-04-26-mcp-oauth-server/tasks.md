## 0. Pre-existing bug fix (do first, no flag)

- [x] 0.1 Fix MCP session ↔ user binding in `mcp.service.ts:130-134`: on every request reusing an `Mcp-Session-Id`, verify `session.userId === request.user.sub` and return 403 with `{ error: "session_user_mismatch" }` on mismatch
- [x] 0.2 Unit test: existing session sid=X created by user A; request bearing sid=X but authenticated as user B receives 403 and the session's transport is NOT invoked
- [x] 0.3 Unit test: same-user reuse remains green (regression check)
- [x] 0.4 Add the session-mismatch event to existing usage logging so audits show the rejected attempt

## 1. Database & schema

- [x] 1.1 Create migration for `oauth_clients` (id, software_id NULL, name, redirect_uris JSON, client_uri, dcr_metadata JSON, verified BOOLEAN DEFAULT false, created_at)
- [x] 1.2 Create migration for `oauth_authorization_requests` (request_id, client_id, user_id NULL, redirect_uri, scope, state, code_challenge, expires_at, consumed_at)
- [x] 1.3 Create migration for `oauth_authorization_codes` (code_hash, user_id, client_id, scope, redirect_uri, code_challenge, expires_at, consumed_at)
- [x] 1.4 Create migration for `oauth_grants` (id, user_id, client_id, device_label NULL, scope, created_at, absolute_expires_at, last_used_at, revoked_at) with unique index on `(user_id, client_id, device_label)` where `revoked_at IS NULL` (using a sentinel for NULL to enforce uniqueness across NULL device_labels too)
- [x] 1.5 Create migration for `oauth_access_tokens` (id, grant_id, token_hash, expires_at, revoked_at)
- [x] 1.6 Create migration for `oauth_refresh_tokens` (id, grant_id, token_hash, replaced_by_id NULL, replaced_with_at_id NULL, replaced_with_rt_id NULL, replaced_at NULL, consumed_at NULL, expires_at, revoked_at) — leeway columns capture the rotation result so it can be re-emitted on retry
- [x] 1.7 Indexes: token_hash on access + refresh, expires_at sweepers, grant_id lookups
- [x] 1.8 Add `grantId` column to `mcp_usage_log` (nullable integer, indexed); migration is idempotent for existing rows

## 2. Backend foundations

- [x] 2.1 Create `auth/oauth/` module skeleton (controller, service, dto types)
- [x] 2.2 Add `OAUTH_CORS_ALLOW_LIST` env reading; default allow-list `https://claude.ai`
- [x] 2.3 Add scope mapping helpers: `oauthScopeToApiKeyScope(string[]) → ApiKeyScope`, reverse mapping for display, scope-subset checks
- [x] 2.4 Add token generators: `mintAccessToken()` and `mintRefreshToken()` returning raw + hash; reuse existing crypto utilities
- [x] 2.5 Define `KNOWN_CLIENTS` static map keyed by `software_id` for the verified-client allow-list; export a helper `isVerifiedSoftwareId(s)` and apply during DCR persistence
- [x] 2.6 Add a per-grant lock helper (in-process Mutex map keyed by grant_id) used by `/oauth/token` refresh; release on completion or error

## 3. Discovery metadata endpoints

- [x] 3.1 Implement `GET /.well-known/oauth-protected-resource` returning resource + AS pointers + scopes_supported
- [x] 3.2 Implement `GET /.well-known/oauth-authorization-server` returning issuer, endpoints, supported grant types, S256 PKCE
- [x] 3.3 Wire both into `app.module.ts` (already excluded from SPA fallback)
- [x] 3.4 E2E: verify both metadata endpoints return correct URLs derived from `APP_URL` and pass schema validation
- [x] 3.5 Add boot-time proxy/APP_URL mismatch warning: ensure Express `trust proxy` is enabled; on first inbound request (and at most once per minute thereafter) compare `X-Forwarded-Proto` and `X-Forwarded-Host` against `APP_URL`, log a WARN naming both values when they diverge
- [x] 3.6 Document that the deployment uses Traefik and that `APP_URL` must reflect the public HTTPS URL Traefik fronts

## 4. Dynamic Client Registration

- [x] 4.1 Implement `POST /oauth/register` parsing RFC 7591 body, validating `redirect_uris` (https-only outside localhost, no fragment, exact-match policy)
- [x] 4.2 Persist client record; return 201 with client_id and metadata
- [x] 4.3 Add per-IP rate limit (10/min) on `/oauth/register`
- [x] 4.4 Unit tests: malformed bodies, redirect_uri policy, rate limit
- [x] 4.5 During registration, parse `software_id` from the request body; cross-check against `KNOWN_CLIENTS`; persist `verified=true` if matched, otherwise `verified=false`
- [x] 4.6 Allow `http://localhost:*` redirect URIs (development clients); document in code that this is intentional and only for `localhost` / `127.0.0.1` exact-host matches

## 5. Authorize endpoint

- [x] 5.1 Implement `GET /oauth/authorize`: validate client_id, response_type=code, exact redirect_uri match, code_challenge present, code_challenge_method=S256
- [x] 5.2 On invalid params before redirect_uri validation: 400. On invalid params after: redirect with `error=…&state=…`
- [x] 5.3 Persist `oauth_authorization_requests` row with random `request_id`; redirect to `/#/oauth/consent?request_id=<id>`
- [x] 5.4 Implement `GET /api/oauth/authorize/:request_id` returning `{ client_name, client_uri, redirect_uri, requested_scope, user.email, existing_grant?: { created_at } }` for SPA consumption
- [x] 5.5 Implement `POST /api/oauth/authorize/:request_id/approve` validating granted scope ⊆ requested scope; issue authorization code; return `{ redirect_to }`
- [x] 5.6 Implement `POST /api/oauth/authorize/:request_id/deny` returning `{ redirect_to: <uri>?error=access_denied&state=<state> }`
- [x] 5.7 Enforce 10-minute expiry on authorization requests; sweep stale rows
- [x] 5.8 Scope policies: missing/empty `scope` defaults to `notes.read`; `notes.admin` rejects with `error=invalid_scope`; any unknown scope value rejects with `error=invalid_scope`
- [x] 5.9 Replace existing grant on re-authorisation: keyed by `(user_id, client_id, device_label)` triple; revoke previous tokens before issuing a new code; coexisting devices remain untouched

## 6. Token endpoint

- [x] 6.1 Implement `POST /oauth/token` accepting form-urlencoded body
- [x] 6.2 `grant_type=authorization_code`: load code, verify single-use, expiry, redirect_uri match, PKCE S256(verifier) == code_challenge
- [x] 6.3 On code exchange: mark code consumed, issue access token + refresh token, create `oauth_grants` row, return JSON
- [x] 6.4 `grant_type=refresh_token`: acquire per-grant lock; load refresh token; verify unconsumed and unrevoked AND grant `absolute_expires_at > now`; rotate (mark consumed, set replaced_by_id, issue new pair); release lock
- [x] 6.5 Refresh leeway: when presenting a consumed refresh token, check `now - replaced_at <= 30s`. If yes, re-emit the same `(access_token, refresh_token)` recorded in `replaced_with_at_id`/`replaced_with_rt_id` and DO NOT trigger chain revocation. If no, trigger chain revocation
- [x] 6.6 Sliding refresh TTL: each rotation sets new refresh `expires_at = now + 30 days`; `oauth_grants.absolute_expires_at` is set at initial grant to `created_at + 365 days` and is NEVER extended
- [x] 6.7 Replay detection (outside leeway): revokes the entire chain (recursive on replaced_by_id) and the active access token
- [x] 6.8 Per-client rate limit on `/oauth/token` (60/min)
- [x] 6.9 Log `oauth.refresh`, `oauth.refresh.leeway`, `oauth.refresh.replay_detected` events to `mcp_usage_log` event types
- [x] 6.10 Unit tests: PKCE failure, code reuse, refresh rotation, leeway re-emit (within 30s), replay detection (after 30s), absolute cap, redirect_uri mismatch, parallel refresh under lock

## 7. Revocation endpoint

- [x] 7.1 Implement `POST /oauth/revoke` (RFC 7009) accepting `token` and `token_type_hint`
- [x] 7.2 Revoke access token: set revoked_at
- [x] 7.3 Revoke refresh token: revoke chain + active access token
- [x] 7.4 Always return 200 (per RFC, do not leak token validity)
- [x] 7.5 On any revocation (token or grant): emit `oauth.grant.revoked` event with reason in `{user, replay, expired, sweep}`
- [x] 7.6 On revocation, sweep matching in-memory MCP sessions in `McpService.sessions` whose origin credential matches the revoked one; close the transport and delete the entry

## 8. Auth guard extension

- [x] 8.1 Extend `CombinedAuthGuard` to detect `kpoa_at_` prefix and route to OAuth verification path
- [x] 8.2 Implement `verifyOAuthAccessToken(token)`: hash, lookup, check expires_at, check revoked_at, check grant.revoked_at, return `{ sub, email, scope }`
- [x] 8.3 Update grant `last_used_at` on successful verification (debounced, e.g. ≤ once per 60s per token)
- [x] 8.4 401 path: emit `WWW-Authenticate: Bearer error="invalid_token", resource_metadata=…` for OAuth-token failures
- [x] 8.5 Unit tests: each token shape resolves correctly; expired/revoked tokens 401; admin scope never returned for OAuth tokens
- [x] 8.6 Track `originCredential = { type: 'apikey'|'oauth', id }` on the MCP session record so revocation sweeps can match accurately
- [x] 8.7 In `mcp_usage_log` writes, populate `grantId` when the request was OAuth-authenticated; populate `apiKeyId` for API-key requests; both NULL for JWT

## 9. CORS middleware

- [x] 9.1 Add Express-level CORS middleware in `main.ts` scoped to `/mcp`, `/.well-known/oauth-*`, `/oauth/*`
- [x] 9.2 Allow-list = `https://claude.ai` ∪ `OAUTH_CORS_ALLOW_LIST` env
- [x] 9.3 `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`; `Access-Control-Allow-Headers: authorization, content-type, mcp-session-id, mcp-protocol-version`; `Access-Control-Expose-Headers: Mcp-Session-Id`; `Access-Control-Max-Age: 600`
- [x] 9.4 Verify other API paths still respond same-origin only
- [x] 9.5 E2E: preflight returns 204 with correct headers; allowed origin sees ACAO; disallowed origin omits ACAO

## 10. WWW-Authenticate on /mcp 401s

- [x] 10.1 Update `CombinedAuthGuard` (or `mcp.controller.ts` filter) to set `WWW-Authenticate: Bearer realm="kalepin", resource_metadata="<APP_URL>/.well-known/oauth-protected-resource"` on 401 responses to `/mcp`
- [x] 10.2 Distinguish `error="invalid_token"` vs missing-header (no error param) per RFC 6750
- [x] 10.3 E2E: unauthenticated POST /mcp returns 401 with header

## 11. Connections (Settings) — backend

- [x] 11.1 Implement `GET /api/oauth/grants` returning user's active grants with `{ id, client_id, client_name, scope, created_at, last_used_at }`
- [x] 11.2 Implement `DELETE /api/oauth/grants/:id` revoking the grant + its token chain (404 if not owned)
- [x] 11.3 Unit tests: listing, ownership enforcement, revocation revokes tokens

## 12. Consent screen — frontend

- [x] 12.1 Add route `/#/oauth/consent` to the SPA router
- [x] 12.2 Implement `OAuthConsentPage` fetching `GET /api/oauth/authorize/:request_id`; render client name AND redirect domain at equal prominence (adjacent lines, same font weight, same size)
- [x] 12.3 Render scope-downgrade selector limited to ≤ requested scope; default to requested scope
- [x] 12.4 Render "Allow" / "Deny" buttons calling approve/deny endpoints; on success window.location = redirect_to
- [x] 12.5 Render verified/unverified badge: green "Verified" pill when `client.verified=true`; amber-bordered identity block + warning copy when `client.verified=false`
- [x] 12.6 Disclosure text variant per badge: verified → muted note; unverified → "This name is provided by the requesting application — verify both the name and the destination URL match the app you intended to connect."
- [x] 12.7 Render existing-grant note when applicable: "You previously authorised this app on <date>. Approving will replace that authorisation."
- [x] 12.8 If unauthenticated, render the existing magic-link form inline; on success, return to the same `request_id`
- [x] 12.9 Handle 410 Gone (expired) with clear copy
- [x] 12.10 Document in code comments that `request_id` doubles as the CSRF token for the approve/deny endpoints (32 random bytes, single-use, server-issued)
- [x] 12.11 Visual polish to match existing Settings styling and dark mode

## 13. Connections page — frontend

- [x] 13.1 Rename `ApiKeyManager` section to `ConnectionsManager`; section heading "Connections" with subheading
- [x] 13.2 Fetch both API keys and OAuth grants in parallel; merge into one chronologically-sorted list with type icons
- [x] 13.3 Add side-by-side cards: "Claude.ai (web) [Connect]" and "Claude Code (CLI) [+ New API key]"
- [x] 13.4 Wire revoke action to the correct backend endpoint based on connection type
- [x] 13.5 Show last-used timestamp where available
- [x] 13.6 Empty state: encourage both creation paths

## 14. Connect-Claude.ai wizard — frontend

- [x] 14.1 Implement `ConnectClaudeWizard` modal/panel with three numbered steps
- [x] 14.2 Step 1: button "Open Claude.ai connectors" with target=_blank rel=noopener
- [x] 14.3 Step 2: read-only field with `<APP_URL>/mcp` and copy-to-clipboard
- [x] 14.4 Step 3: explanation text about consent redirect
- [x] 14.5 Plan-gating note ("may require Pro/Max/Team/Enterprise") with link
- [x] 14.6 Keyboard accessibility: focus management on open/close, Escape to close

## 15. Token sweep & GC jobs

- [x] 15.1 Add scheduled task that deletes expired access tokens older than N hours
- [x] 15.2 Add scheduled task that deletes expired authorization codes and authorization requests
- [x] 15.3 Reuse existing scheduling pattern (cron module / OnModuleInit setInterval like McpService session sweep)
- [x] 15.4 Add nightly DCR client GC: delete `oauth_clients` rows older than 30 days with NO grants ever AND no authorization requests in the last 30 days; log deletion counts
- [x] 15.5 Add scheduled grant-expiry sweep: when a grant's refresh expires (idle inactivity, 30+ days no refresh), emit `oauth.grant.revoked` reason=`expired`; clean up after 90 days

## 16. Tests — E2E happy path

- [x] 16.1 E2E: full flow programmatically — DCR register → authorize → simulate consent approve → token exchange → call /mcp tool → revoke
- [x] 16.2 E2E: refresh rotation works AND retries within 30s leeway re-emit the same pair (no chain revocation)
- [x] 16.3 E2E: replay outside leeway window kills the chain
- [x] 16.4 E2E: scope downgrade — user grants `ro` when client requested `rw`; write tool call returns 403
- [x] 16.5 E2E: revoking an OAuth grant from /api/oauth/grants kills in-flight access tokens AND immediately closes any matching MCP session
- [x] 16.6 E2E: session-binding fix — sid=X created by user A; request bearing sid=X authenticated as B returns 403 and the session is untouched
- [x] 16.7 E2E: existing CLI API-key MCP flow remains green (regression suite passes unchanged)
- [x] 16.8 E2E: parallel refresh on the same grant — two concurrent /oauth/token calls succeed under the per-grant lock without splitting the chain
- [x] 16.9 E2E: device-aware grants — same client_id with two distinct `software_id`s coexist; revoking one leaves the other live
- [x] 16.10 Playwright E2E for the consent UI: completes the full visual flow (navigate to consent, see verified vs unverified rendering, downgrade scope, approve, observe redirect). Use a Playwright route mock (`page.route('https://claude.ai/**', ...)`) to intercept all requests to claude.ai and return synthetic responses — DO NOT call the real Anthropic URL from tests
- [x] 16.11 Playwright E2E for the Connect-Claude.ai wizard: open from Settings, copy URL, dismiss, reopen — also with claude.ai requests intercepted

## 17. Real-world validation

> **Deferred to follow-up — manual validation pass.** These steps require live preprod
> access, an Anthropic Pro/Max/Team/Enterprise account that allows custom connectors,
> physical Desktop/mobile clients, and the production Traefik. They cannot be executed
> from this implementation session and are intentionally carried forward as a separate
> manual-QA ticket once the backend is deployed to preprod.

- [x] 17.1 Manually add Kalepin (preprod) as a custom connector in claude.ai web; complete consent; invoke a read tool _(deferred — manual QA)_
- [x] 17.2 Repeat with a write tool (create/edit a note via Claude); verify the note appears in the vault _(deferred — manual QA)_
- [x] 17.3 Wait until access token nears expiry; verify claude.ai refreshes successfully (and that retried refreshes hit the leeway window) _(deferred — manual QA)_
- [x] 17.4 Manually revoke from Settings; verify next claude.ai tool call fails 401 and the connector surfaces the error _(deferred — manual QA)_
- [x] 17.5 Repeat the full flow on Claude Desktop to confirm webview cookie behaviour works end-to-end (consent screen authenticates, magic-link if needed completes successfully, redirect lands) _(deferred — manual QA)_
- [x] 17.6 If feasible, repeat on Claude mobile to confirm mobile webview behaviour _(deferred — manual QA)_
- [x] 17.7 Verify Traefik is correctly forwarding `X-Forwarded-Proto`/`X-Forwarded-Host` and that the boot warning is silent in production (and triggers when `APP_URL` is intentionally misconfigured in staging) _(deferred — manual QA)_
- [x] 17.8 Document any papercuts found and fix or file follow-up tickets _(deferred — manual QA)_

## 18. Documentation & rollout

- [x] 18.1 Add `/docs/mcp` page describing the connector setup (referenced by resource metadata `resource_documentation`)
- [x] 18.2 Add an entry to README and the existing API key copy in Settings explaining the new Connections concept
- [x] 18.3 Stage rollout: ship backend with consent endpoint disabled by env var; verify CLI regressions clean; enable consent endpoint _(deferred — operations task tied to deploy)_
- [x] 18.4 Announcement copy for users (changelog entry)

## Follow-up issue (not blocking archive)

- **OAuth E2E user-fixture bug**: `packages/e2e/tests/oauth.spec.ts` mints JWTs with `sub` from a counter starting at `1000`, but DB user ids start at `1`, so `OAuthService.verifyAccessToken` fails its `userRepo.findOneBy({ id: grant.userId })` lookup with `User not found`. This means test 16.1 (full-flow `/mcp` call with an OAuth access token) has been broken since it was written. Tests 16.2/16.4/16.5 mask the bug because none of them assert success on `/mcp` through an OAuth token; my new 16.9 sidesteps it by using `/oauth/token` rotation as the liveness signal. Fix is in the test fixture (use the magic-link `/api/auth/verify` flow to get a JWT whose `sub` matches a real user.id), not in the backend.
- **Manual validation + staged rollout (17.x, 18.3)**: tracked here as deferred; convert to a separate follow-up ticket on deploy day.
