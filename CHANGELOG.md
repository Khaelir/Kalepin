# Changelog

## 0.5.82 — 2026-10-26

### Added

- **Sign in with Microsoft (optional).** Teams on Microsoft 365 can sign in with their Entra ID work account, next to the magic link, which stays available to everyone. Single tenant only: Kalepin is pinned to one tenant and rejects tokens from any other. Accounts are matched by email, so existing magic-link users land in the same account, with the same notes and personal folder. Microsoft's tokens are used once and discarded. Off until configured; setup guide in [docs/microsoft-sso.md](docs/microsoft-sso.md).

### Configuration

- New optional `SSO_MICROSOFT_TENANT_ID`, `SSO_MICROSOFT_CLIENT_ID`, `SSO_MICROSOFT_CLIENT_SECRET_FILE` / `SSO_MICROSOFT_CLIENT_SECRET` and `SSO_MICROSOFT_AUTHORITY_HOST`. A partial or invalid configuration logs a warning and leaves the button off; it never stops Kalepin from starting.
- `DOMAIN_ALLOWLIST` now applies to every login method and matches domains case-insensitively. An entry like `Example.com`, which used to match nobody, now matches `@example.com` addresses.

### Fixed

- **Magic links sent from the OAuth consent screen return to it.** The session token was appended after the `#/oauth/consent?request_id=…` fragment, so the SPA never saw it and the consent request was lost. It now goes before the fragment.

## 0.5.57 — 2026-05-01

### Added

- **Per-user "Personal" folders.** A new private namespace at `_users/{email}/...` (virtual) / `personal/{email}/` (physical), enabled by setting the new `PERSONAL_PATH` environment variable. Personal notes are owner-only across every surface — HTTP, WebSocket, MCP, full-text and semantic search, attachments, share links, change feed, link/graph, and mention notifications — and foreign personal paths return `404 Not Found` (existence is not observable). Auto-created on first authenticated request; auto-included in admin backup and the S3 backup roundtrip; soft-deleted to `personal/.deleted/{email}-{timestamp}/` on user removal.
- **Mention-suppression for personal notes.** Mentions in comments / doc-mentions / thread replies inside a personal folder are suppressed for any recipient other than the folder owner — closing an out-of-band content leak channel.
- **Attachment per-namespace routing.** Attachments uploaded inside a personal note land in `personal/{email}/_attachments/`. Shared notes' attachments stay at `vault/_attachments/`. Legacy embed URLs (`?name=X`) keep working unchanged. Cross-boundary moves copy the referenced attachment so the doc still renders at the destination.

### Configuration

- New `PERSONAL_PATH` env var (default unset). When set to a directory peer to `VAULT_PATH`, personal folders are enabled. When unset, storage stays single-root against `VAULT_PATH` (clean rollback).

### Security

- **Email canonicalization at the auth boundary.** JWTs are canonicalized once at issuance / verification (`canonicalizeEmail`); downstream code treats `req.user.email` as trusted. Strict regex rejects RFC-edge-case emails (quoted local parts, IDN/unicode local parts, whitespace, control characters) at auth-time so they cannot leak into LIKE patterns or path concatenations.
- **LIKE-pattern injection defense.** Email metacharacters (`_`, `%`) in legal addresses like `john_doe@x.com` no longer act as SQL `LIKE` wildcards across user boundaries — the search predicate binds `escapeLike(email)` and uses `ESCAPE '\\'`. Locked in by a CRITICAL regression test.
- Search FTS, comment search, vector search, link graph, change feed, and the MCP tool surface are all gated by a single visibility predicate (`isVisibleTo`).

## 0.5.56 — 2026-04-27

### Changed

- **Editor uses more of your screen on wide displays.** The note column now scales up on viewports wider than ~1400px (and again at 1700/2100/2500/3000px), so the prose stops looking stranded in the middle of an empty page on large monitors. Laptops keep the original measure.
- **Right panel is now collapsible.** A chevron toggle in the Comments/Backlinks/History tab row collapses the panel down to a 48px strip; expanded view returns when you click it (or any tab icon) again. The panel also auto-collapses when the current note has no comments and no backlinks, and re-expands automatically as soon as either appears.

## 0.5.55 — 2026-04-26

### Added

- **Connect Claude.ai directly to your notes.** Kalepin now ships a full OAuth 2.1 + PKCE authorization server, so Claude.ai web, Claude Desktop, and Claude mobile can connect to your vault without pasting an API key. Open **Settings → Connections → Connect** to walk through the setup; Claude redirects back to Kalepin to confirm the permission level (read, comment, or full).
- **Unified Connections settings.** The old "API keys" page becomes **Connections** — one place to see every Claude.ai grant *and* every CLI API key, with last-used timestamps and a single revoke action per row.
- **Per-connection scope downgrade.** When Claude requests `Full` access you can grant `Read` or `Read + Comment` instead, directly from the consent screen.
- **OAuth discovery metadata.** Public `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/oauth-protected-resource` (RFC 9728) endpoints, plus a human-readable setup page at `/docs/mcp`.

### Security

- **Fixed an MCP session privilege-escalation bug.** Reusing a stranger's `Mcp-Session-Id` no longer borrows their scope. Mismatched-user requests now return 403 and the rejected attempt lands in the audit log.
- **Refresh-token rotation with replay-chain revocation.** OAuth refresh tokens are single-use; presenting a consumed token outside a 30-second leeway window revokes the entire chain and the active access token.
- **Immediate session sweep on revoke.** Revoking a grant or API key from Settings closes any matching MCP sessions instantly instead of letting them age out.

### Configuration

- New env var `OAUTH_CORS_ALLOW_LIST` (comma-separated origins) to allow extra browser origins to call `/mcp` and `/oauth/*`. `https://claude.ai` is always allowed.
- `APP_URL` is now load-bearing for OAuth discovery. Behind a TLS-terminating reverse proxy (e.g. Traefik), set it to the public `https://…` URL — the backend logs a WARN at boot when `X-Forwarded-Proto`/`X-Forwarded-Host` disagree with `APP_URL`.
- New env var `OAUTH_CONSENT_DISABLED=1` (off by default) keeps the OAuth endpoints reachable but blocks consent approval — useful as a safe staged-rollout switch.
- New env var `OAUTH_PREREGISTERED_CLIENT_IDS` (comma-separated) to inject known `client_id`s into `oauth_clients` at boot. Use only when claude.ai already has a connector registered with a hand-picked `client_id` (e.g. a connector installed before this OAuth feature shipped). Pre-registered rows are public clients (PKCE, no secret) locked to claude.ai's MCP callback.
