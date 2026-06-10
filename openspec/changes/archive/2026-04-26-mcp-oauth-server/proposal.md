## Why

Today Kalepin's MCP server is reachable only from CLI clients (Claude Code) using static `kp_` API keys pasted into a config file. The much larger audience — users of `claude.ai` web, Claude Desktop, and Claude mobile — cannot connect, because those clients require an OAuth 2.1 + PKCE flow with Dynamic Client Registration. Closing that gap unlocks Kalepin for everyday "ask Claude about my notes" usage and brings the same surface to mobile, where no API-key paste flow is realistic.

## What Changes

- Add a full OAuth 2.1 authorization server inside the existing backend, sharing user identity with the current magic-link / JWT auth. New endpoints: `POST /oauth/register` (RFC 7591 DCR), `GET /oauth/authorize`, `POST /oauth/token`, `POST /oauth/revoke`.
- Add OAuth discovery metadata: `GET /.well-known/oauth-protected-resource` (RFC 9728) and `GET /.well-known/oauth-authorization-server` (RFC 8414). Both are public, unauthenticated.
- Issue opaque access tokens (`kpoa_…` prefix, DB-backed, short-lived ~1h) and opaque refresh tokens (one-time-use, rotated on each refresh, replay detection revokes the entire chain).
- Extend `CombinedAuthGuard` to recognise OAuth access tokens as a third credential shape alongside `kp_` API keys and JWT — same `request.user` shape, same scope checks.
- Add a consent screen at `/oauth/authorize` rendered by the frontend. Users see the requesting client name, requested scope, and may downgrade scope (e.g. grant `ro` even when `rw` was requested).
- Add CORS for `/mcp` and `/.well-known/*` allowing `https://claude.ai` and Anthropic-controlled origins, with `Mcp-Session-Id` in `Access-Control-Expose-Headers` so browser MCP clients can read the session header on init responses.
- Reframe the Settings "API keys" section as **Connections**: a single list of all credentials (CLI API keys + active OAuth grants) with consistent revoke / last-used / scope display.
- Add a "Connect to Claude.ai" wizard in Settings that copies the MCP URL, links to claude.ai's connector page, and explains the consent flow users will see.
- Map existing `ApiKeyScope` (`ro`/`rc`/`rw`/`admin`) onto OAuth `scope` strings (`notes.read`, `notes.comment`, `notes.write`, `notes.admin`).

## Capabilities

### New Capabilities
- `oauth-authorization-server`: DCR registration, authorization code flow with PKCE, access/refresh token issuance, refresh rotation with replay detection, revocation.
- `oauth-discovery-metadata`: Public `.well-known` JSON endpoints advertising AS metadata and the protected MCP resource.
- `oauth-consent-ui`: Frontend consent screen with client identity, requested scope, and user-selectable scope downgrade.
- `mcp-cors`: CORS allow-list for `/mcp` and `/.well-known/*` with `Mcp-Session-Id` header exposure for browser-based MCP clients.
- `claude-ai-connect-wizard`: Settings affordance guiding users through adding Kalepin to claude.ai as a custom connector.

### Modified Capabilities
- `api-key-auth`: Guard accepts a third bearer token shape — opaque OAuth access tokens (`kpoa_` prefix) — resolved via DB lookup and producing the same `request.user` shape and scope checks as API keys. Adds normative session-binding rule: requests reusing an `Mcp-Session-Id` MUST present credentials matching the session's stored user, fixing a pre-existing privilege-escalation bug surfaced by the OAuth review.
- `api-keys-management`: Settings "API keys" page is reframed as "Connections" and now also lists OAuth grants (one row per active client/user pair) with the same revoke action.
- `mcp-usage-logging`: `mcp_usage_log` gains a `grantId` column; new event types record OAuth lifecycle (refresh, leeway re-emit, replay detection, grant revocation) for audit and alerting.

## Impact

- **Code**: new `auth/oauth/` module (controller, service, DCR, token store), new `auth/well-known/` controller, new `connections/` module (or reframed `api-keys/`), CORS middleware in `main.ts`, frontend `ConnectionsPage` + `OAuthConsent` route + `ConnectClaudeWizard`. `CombinedAuthGuard` extended.
- **Database**: new tables `oauth_clients`, `oauth_authorization_codes`, `oauth_access_tokens`, `oauth_refresh_tokens`. Migrations follow existing pattern.
- **Dependencies**: no new runtime dependencies expected — JWT signing (already present) and crypto random (already used) are sufficient. PKCE verification is ~10 lines.
- **Security surface**: new public `/oauth/*` endpoints; rate-limit `/oauth/token` and `/oauth/register`. Consent UI must defend against open-redirect (validated `redirect_uri` must match DCR registration exactly).
- **External**: requires public HTTPS reachability (already true for preprod). Free-tier claude.ai users may not be able to add custom connectors — the wizard surfaces this.
- **Backward compatibility**: existing `kp_` API keys and JWT continue to work unchanged. No migration of existing credentials.
