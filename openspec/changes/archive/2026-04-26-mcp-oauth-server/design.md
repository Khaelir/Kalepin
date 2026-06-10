## Context

Kalepin already exposes a working MCP server at `POST/GET/DELETE /mcp` using `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`. Authentication is handled by `CombinedAuthGuard` which accepts two credential shapes today: opaque `kp_…` API keys (DB-backed, hashed at rest, with scopes) and JWTs minted from magic-link login. Tools are registered in `McpService.createMcpServer(user)` and read from `request.user.{ sub, email, scope }`.

claude.ai web (and Claude Desktop, Claude mobile) speak MCP over the same Streamable HTTP transport, so the wire protocol is already compatible. What they will not do is accept a hand-pasted bearer token; their connector flow performs OAuth 2.1 with PKCE and Dynamic Client Registration (RFC 7591), discovering the authorization server through `/.well-known/oauth-protected-resource` (RFC 9728) on the resource and `/.well-known/oauth-authorization-server` (RFC 8414) on the AS.

The existing magic-link flow is the natural backbone for the AS: it already authenticates a human, mints a JWT, and provisions a user record. OAuth here is mostly thin plumbing on top: client registration table, code/token issuance, consent UI, discovery JSON. A new database surface and new public endpoints are introduced; no existing authenticated endpoint changes its contract.

Stakeholders: end users (gain claude.ai connectivity), the operator (one new public surface to monitor and rate-limit), the existing CLI users (must remain unaffected).

## Goals / Non-Goals

**Goals:**
- Make Kalepin's MCP server addable as a custom connector in claude.ai web, Claude Desktop, and Claude mobile, for any user, with both read and write tools.
- Reuse existing identity (magic link, user table, scopes) — no second account system.
- Treat OAuth grants and CLI API keys uniformly in the UI ("Connections") and uniformly in code (single guard, single `request.user` shape).
- Pass the standard MCP authorization tests: `WWW-Authenticate` challenge, DCR, PKCE, refresh rotation with replay detection, revocation.
- Keep the existing `kp_` flow and JWT flow byte-compatible — zero behaviour change for current CLI users.

**Non-Goals:**
- Acting as a generic OAuth provider for third-party apps (no consent for arbitrary scopes, no app marketplace). The AS exists to authorise MCP clients against this resource server.
- Supporting OAuth 2.0 implicit flow, password grant, or client credentials. Only authorization code + PKCE + refresh.
- Federation with external IdPs (Google, Microsoft) — magic link remains the only way to authenticate a human.
- A "push" integration that proactively registers Kalepin inside someone's claude.ai account. The connector handoff is always initiated from claude.ai.
- Token introspection endpoint (RFC 7662). Not needed for our deployment topology — the resource server and AS share a database.

## Decisions

### Decision 1: Opaque tokens, DB-backed, with `kpoa_` prefix

**Choice:** Access and refresh tokens are random 32-byte values, base64url-encoded, prefixed `kpoa_at_` and `kpoa_rt_`. Tokens are stored as SHA-256 hashes (matching the existing `kp_` pattern). Lookup on each request.

**Why over JWT access tokens:**
- Existing `kp_` keys are already opaque and DB-backed. Mixing JWT access tokens would force the guard to maintain two verification paths and a denylist for revocation.
- Revocation is immediate and trivially auditable (delete row → next request 401).
- Database hit per MCP request is acceptable: the same guard already does a DB lookup for `kp_` keys and the MCP path is not high-QPS.
- Prefix discrimination (`kp_` vs `kpoa_`) lets the guard route to the correct table without trying both.

**Alternatives:**
- Signed JWT access tokens (faster, no DB hit) — rejected for the revocation cost and the second code path.
- Reuse the `api_keys` table with a `source = 'oauth'` column — rejected because OAuth tokens have lifetimes, refresh chains, and client_id linkage that don't fit the API-key schema cleanly.

### Decision 2: Refresh-token rotation with one-time use and replay-chain revocation

**Choice:** Each `/oauth/token` refresh issues a new refresh token and marks the old one consumed. If a consumed refresh token is presented again, the entire chain (all descendants) is revoked and the access token tied to the chain is invalidated.

**Why:** This is the standard MCP / OAuth 2.1 best practice and detects token theft. The cost is one extra column (`replaced_by_id`) and a small recursive revoke on replay.

**Alternative considered:** Long-lived non-rotating refresh tokens — rejected; claude.ai will rotate, and not rotating means a stolen refresh token grants access until manual revoke.

### Decision 3: Consent UI rendered by the frontend SPA, not server-side HTML

**Choice:** `GET /oauth/authorize` validates parameters server-side, then redirects (or 302s) into the SPA at `/#/oauth/consent?…` with a one-time `request_id` in the URL. The SPA fetches the request details (`GET /api/oauth/authorize/:request_id`), renders the consent screen using existing styling, and submits approval (`POST /api/oauth/authorize/:request_id/approve`) which returns the redirect URL to the OAuth client.

**Why:** Consent is a high-trust UX moment. Reusing the existing SPA gives us proper styling, dark mode, the user's normal session, and lets us show familiar elements (the user's name, vault list). Server-side HTML would add a new templating dependency and a second visual identity.

**Alternative considered:** Plain server-side HTML page — rejected on UX grounds; a half-styled "click here to allow" page is exactly the kind of thing that trains users to click through phishing.

### Decision 4: Reuse the magic-link flow when the user is not signed in during `/oauth/authorize`

**Choice:** If the consent screen detects no active session, it shows the existing magic-link form inline; on success the user lands back on consent with the same `request_id`.

**Why:** Single source of truth for "how to log in to Kalepin". Avoids inventing a second login experience for the OAuth path.

### Decision 5: Map `ApiKeyScope` → OAuth scope strings, fixed table

| ApiKeyScope | OAuth scope string                  | Notes                          |
|-------------|-------------------------------------|--------------------------------|
| `ro`        | `notes.read`                        | Default safe scope             |
| `rc`        | `notes.read notes.comment`          | Read + comments                |
| `rw`        | `notes.read notes.comment notes.write` | Read + comments + write     |
| `admin`     | (not exposed via OAuth)             | Admin remains JWT/API-key only |

`admin` is intentionally not granted via OAuth — admin operations should never be brokered through a third-party client.

**Why a fixed mapping:** Avoids the explosion of free-form scopes. The frontend already knows how to render these four levels.

### Decision 6: DCR is open but consent is the trust boundary

**Choice:** `POST /oauth/register` accepts any well-formed registration request and returns a `client_id` + (optionally) `client_secret`. We do not pre-approve clients. The trust gate is the consent screen, where the user sees the registered client name and decides.

**Why:** This matches the MCP authorization spec and what every other MCP server does. Pre-approving clients defeats the point of DCR (any new MCP-capable app would need us to mint credentials).

**Mitigation:** The consent screen displays the raw client-supplied name with a clear "this name is provided by the requesting application — verify the URL you came from" disclosure. We rate-limit `/oauth/register` per IP.

### Decision 7: Single CORS allow-list for `/mcp` and `/.well-known/*`

**Choice:** Add Express CORS middleware applied only to `/mcp` and `/.well-known/*` paths, with the allow-list `https://claude.ai`, plus an env var `OAUTH_CORS_ALLOW_LIST` for self-hosted users to add their own origins. Expose `Mcp-Session-Id` in `Access-Control-Expose-Headers`. The rest of the API stays first-party only.

**Why scoped, not global:** Keeps the existing same-origin assumption for the SPA's API calls. Only the public-facing OAuth/MCP surfaces accept cross-origin.

### Decision 8: One active OAuth grant per (user, client) pair — re-authorising replaces

**Choice:** When a user completes the consent flow for a client they have already authorised, the new grant replaces the old one (old refresh chain revoked, old access tokens revoked). Active access tokens already in flight on the old chain stop working.

**Why:** Matches every other OAuth provider's behaviour. Users expect "I removed and re-added it" to mean "the old one is gone". Stacking grants leads to confusing revoke UI.

### Decision 9: `connections-management` is a new capability, not a delta on `api-keys-management`

**Choice:** Create a new `connections-management` capability that owns the unified Settings page. Mark `api-keys-management` as superseded (its requirements move into the new capability with broader semantics). The existing API-key-create/revoke endpoints stay in `api-key-auth`.

**Why:** The Settings UI's behaviour materially expands (multiple connection types, OAuth-specific fields like client name and last-used). A delta would obscure how much the UI changed; a new capability makes the supersession explicit.

### Decision 10: Fix the pre-existing MCP session ↔ user binding bug as part of this change

**Background:** `mcp.service.ts:130-134` reuses a session by ID without verifying the request's authenticated user matches the session's stored `userId`. The `McpServer` is built at initialize-time with the user closed over, so subsequent requests run tools against the init-time identity regardless of who presents the session ID. With Kalepin's single-shared-vault model this is **not** cross-tenant data theft, but it **is** privilege escalation (lower-scope user inheriting higher-scope session) and audit-log misattribution. OAuth materially expands the attack surface (more tokens, more clients, more network hops), so the fix lands inside this change rather than as a separate one.

**Choice:** On every request that supplies an `Mcp-Session-Id`, compare `session.userId === request.user.sub`. On mismatch return 403 Forbidden and do NOT touch the session. Additionally, on revocation of a grant or API key, sweep matching MCP sessions immediately rather than letting them age out via TTL.

**Why:** Tightest fix without architectural change. The session map already stores `userId`; we just have to consult it on every request. The proactive sweep on revoke (Decision 12 below) closes the same hole from the other side.

### Decision 11: Refresh-token leeway window for legitimate retries

**Choice:** When a refresh token has been rotated within the last 30 seconds, presenting the *consumed* refresh token returns the same `(access_token, refresh_token)` pair issued by that rotation rather than triggering chain revocation. Outside the window, replay detection fires as designed.

**Why:** A naive RFC reading kills the chain on any duplicate `/oauth/token` call, including the legitimate retry after a network blip. OAuth 2.1 BCP §4.14 explicitly permits a small grace period. 30 seconds is enough for a TCP retry round trip and short enough that a stolen refresh token can't realistically be replayed.

**Implementation:** store `replaced_with_at_id, replaced_with_rt_id, replaced_at` on the consumed refresh row; on replay within window, look up the replacement and re-emit. Outside the window, drop into the existing chain-revocation path.

### Decision 12: Sliding refresh TTL with hard absolute cap

**Choice:** Refresh tokens issued at `T0` carry `expires_at = T0 + 30 days`. Each successful rotation resets `expires_at` to `now + 30 days`. The grant carries `absolute_expires_at = T0 + 365 days` set at the *initial* grant; rotations cannot push past this cap. Once the absolute cap hits, the next refresh fails with `invalid_grant` and the user re-consents.

**Why:** Daily users get a smooth experience (no forced re-consent every 30 days), idle grants self-revoke, and a year of continuous activity still triggers a periodic re-consent — useful for recovering from undetected token theft.

**Idle inactivity revoke:** if no refresh happens within the 30-day window, the refresh token expires naturally; the grant remains in the user's Connections list as "expired" until the user revokes it, or until the GC sweep removes expired grants after 90 days.

### Decision 13: Per-grant refresh lock to serialise concurrent rotations

**Choice:** `/oauth/token` with `grant_type=refresh_token` acquires a per-grant advisory lock (`SELECT … FOR UPDATE` on the grant row, or in-process Mutex map keyed by grant_id) for the duration of the rotation. Concurrent refresh calls on the same grant queue.

**Why:** claude.ai issues parallel tool calls. If two near-simultaneous tool calls both 401 on a near-expiry access token, both will trigger refresh. The leeway window (Decision 11) handles the *same* refresh token being presented twice; the lock prevents two distinct refresh tokens being issued for the same grant in parallel, which would split the chain.

### Decision 14: Device-aware uniqueness key for grants

**Choice:** Update the unique constraint from `(user_id, client_id) WHERE revoked_at IS NULL` to `(user_id, client_id, device_label) WHERE revoked_at IS NULL`, where `device_label` is read from the DCR registration's `software_id` + `software_version` if present, otherwise NULL.

**Why:** If Anthropic ever ships a single global `client_id` across web/desktop/mobile, signing in on one platform would silently revoke the others. With `device_label` in the key, web and desktop coexist as separate grants in the user's Connections list. When the field is NULL (older clients), we fall back to the original `(user_id, client_id)` semantics — replace.

### Decision 15: Verified-client allow-list (static, admin-managed)

**Choice:** Maintain a small static map in code: `KNOWN_CLIENTS = { "anthropic-claude-ai": { display_name: "Claude.ai", verified: true } }`. When DCR registration's `software_id` matches a known entry, store a `verified=true` flag on the client row. The consent screen renders a green "Verified" badge next to verified clients; unverified clients show an amber "Unverified — verify the URL above is correct" warning.

**Why:** DCR is intentionally open; the consent screen is the trust gate. A verified badge is the only practical signal we can give users about which clients we have out-of-band confidence in. Starts empty; we add Anthropic only after they actually register and we cross-check the `software_id` they use.

### Decision 16: Prominent redirect-domain display on consent

**Choice:** The consent screen renders the registered `redirect_uri`'s domain on its own line, in the same prominence as the client name (e.g. directly under it, not in a tooltip). For unverified clients, both the client name AND the redirect domain are framed by an amber border with the unverified disclosure.

**Why:** A phishing attacker registers a client called "Claude.ai" with `redirect_uri=https://claude-ai-fake.attacker.com`. The redirect domain is the strongest visible signal that something is off. Burying it in a tooltip leaves users with only the attacker-controlled name to evaluate.

### Decision 17: Boot-time warning for `APP_URL` / proxy mismatch

**Choice:** On startup, log a clear warning when the configured `APP_URL` doesn't match the protocol/host of incoming requests after a brief grace period (e.g. 60 seconds of observed traffic). Specifically, check `X-Forwarded-Proto` and `X-Forwarded-Host` (set by Traefik's default middleware) against `APP_URL` and warn loudly if they diverge — this is the most common self-hosted footgun and breaks OAuth discovery.

**Why:** Self-hosted operators (the deployment uses Traefik as a reverse proxy) often forget to set `APP_URL` correctly when fronting Kalepin behind TLS termination. Discovery metadata then advertises the wrong issuer, and claude.ai rejects the AS as not matching. A loud boot-time warning saves a support ticket per affected operator.

**Trust source for the proxy headers:** Express's `trust proxy` setting must be enabled (it likely already is, given `req.get('host')` is used in `main.ts`), otherwise the `X-Forwarded-*` headers are ignored and the warning is meaningless.

### Decision 18: Explicit policies for empty/unknown/admin scope at /authorize

**Choice:**
- Missing or empty `scope` parameter → default to `notes.read` (safest)
- Unknown scope value (not in `{notes.read, notes.comment, notes.write}`) → reject with `error=invalid_scope`
- `notes.admin` requested → reject with `error=invalid_scope` (drop-with-warning was the alternative; rejection is cleaner — admin via OAuth is never intended)

**Why:** Removes ambiguity in the spec. Each policy has one obvious right answer; pinning them down avoids drift between the AS implementation and the consent UI.

### Decision 19: DCR client garbage collection

**Choice:** A nightly job deletes `oauth_clients` rows that satisfy ALL of: `created_at` older than 30 days, no associated `oauth_grants` ever (active or revoked), no associated `oauth_authorization_requests` in the last 30 days. Logs the deletion count.

**Why:** Without cleanup, a malicious DCR loop fills the database. Per-IP rate limit slows but doesn't stop a distributed botnet. The "ever issued a grant" gate ensures legitimate registrations stay even if the user takes a long time to actually authorise.

### Decision 20: OAuth events flow into existing `mcp-usage-logging`

**Choice:** Extend the usage-logging schema to record `grant_id` alongside `api_key_id` (one of the two is set per call; both NULL only for JWT). Add three new event types beyond tool calls: `oauth.refresh` (grant_id, success, latency), `oauth.refresh.replay_detected` (grant_id, chain revoked), `oauth.grant.revoked` (grant_id, reason: user/replay/expired/sweep).

**Why:** Existing observability dashboards already work off this table. Folding OAuth events in keeps one source of truth. `replay_detected` events are the canary for client compromise and deserve high-visibility alerting.

### Decision 21: Consent endpoints are CSRF-safe by `request_id` design

**Choice:** Document that `request_id` (32 random bytes, server-issued, single-use) functions as a CSRF token for `POST /api/oauth/authorize/:request_id/{approve,deny}`. No additional CSRF token is required even if the session cookie is `SameSite=Lax`.

**Why:** Cross-site forgery requires the attacker to know `request_id` to forge the call. Since `request_id` is opaque, server-issued, and single-use, an attacker cannot predict or reuse it. Documenting this saves a future reviewer reaching for a CSRF library.

## Risks / Trade-offs

- **[Open redirect via DCR]** A malicious DCR registration could supply a `redirect_uri` pointing at an attacker-controlled site, then drive a victim through the consent flow. → Mitigation: `redirect_uri` in `/oauth/authorize` must exactly match (string-equal) one of the URIs registered in DCR. PKCE prevents code interception even if the redirect succeeds. The consent screen also prominently displays the redirect destination domain.

- **[Refresh-token theft]** A stolen refresh token grants access until detected. → Mitigation: rotation with one-time-use + chain revocation on replay. Add an admin endpoint to list and revoke active grants per user. Log every refresh event for forensic timeline.

- **[Free-tier claude.ai may not allow custom connectors]** Plan gating could mean the wizard sends users to a UI that doesn't have the "Add connector" affordance. → Mitigation: the wizard's first paragraph names the requirement explicitly and links to claude.ai's connector documentation. We do not block backend launch on this — Pro/Max users can still connect.

- **[Browser MCP traffic patterns differ from CLI]** claude.ai web may send more parallel tool calls and more aggressive session management than Claude Code. → Mitigation: keep the existing usage logging on; add an alert if `/mcp` 5xx rate jumps post-launch; consider per-token concurrency limit if abuse appears.

- **[Consent fatigue]** First-time OAuth on top of magic-link is two click-throughs. → Mitigation: unify visually so the consent screen feels like the rest of Kalepin; remember the user's last scope choice across re-authorisations.

- **[Token table growth]** Without pruning, expired access tokens accumulate forever. → Mitigation: scheduled sweep of expired access tokens (similar to existing MCP session sweep). Refresh tokens stay until explicitly revoked or chain-killed.

- **[`kpoa_` prefix collision]** A future feature might want a similar prefix. → Trade-off accepted; document the prefix table in `auth/permissions.ts`.

- **[Rolling our own OAuth vs library]** We are choosing not to use `@node-oauth/oauth2-server`. → Trade-off: more code to maintain, but cleaner integration with the existing magic-link / API-key code, no library upgrade cycle, and the OAuth surface is small (~600 LOC). Revisit if/when SAML or third-party IdP federation lands.

## Migration Plan

The change is additive — no data migration required.

1. Ship backend (DB migration + AS endpoints + guard extension + CORS) behind no flag, but with `/oauth/register` rate-limited and the consent endpoint disabled by env var initially.
2. Verify CLI MCP and existing API-key flows are byte-identical (E2E suite must stay green).
3. Enable consent UI and run through the full flow against claude.ai web in a sandboxed account; iterate on papercuts.
4. Ship the Settings "Connections" UI and the Connect Claude.ai wizard.
5. Announce to users.

**Rollback:** Disable consent UI via env var; OAuth endpoints return 503. claude.ai connections fail to refresh and degrade to 401. CLI users unaffected. Re-enable once issue is fixed.

## Open Questions

- Should we expose `prompt=login` to force re-authentication during `/authorize` even if a session exists? Probably yes for consistency with other AS implementations, but adds UI work.
- Should the consent screen surface the requesting client's homepage URI (DCR `client_uri`)? Likely yes, but with a "this URL is unverified" caveat.
- Do we want to support PAR (RFC 9126 Pushed Authorization Requests)? Not required by claude.ai today; defer.
- ~~Should refresh tokens be sliding-window or fixed?~~ **Resolved** in Decision 12: sliding with a 1-year hard cap.
