## Why

Kalepin's only login method today is a magic-link email. Teams already on Microsoft 365 want to sign in with the work account they use everywhere else: one click, with their organisation's MFA and conditional access, and no waiting for an email. Kalepin is also open source, so this must stay entirely optional, and it must not weaken the domain allowlist or let an outside Microsoft tenant claim an existing account by email.

## What Changes

- Add **"Sign in with Microsoft"** (Entra ID, OpenID Connect authorization-code flow with PKCE) as a convenience login next to the magic link. The magic link remains available to every user.
- Microsoft sign-in is **single-tenant only**: Kalepin is pinned to one Entra tenant via `SSO_MICROSOFT_TENANT_ID` (GUID), refuses the multi-tenant values `common` / `organizations` / `consumers`, and rejects any ID token whose `tid` differs.
- The provider is **enabled only when fully configured** (`SSO_MICROSOFT_TENANT_ID`, `SSO_MICROSOFT_CLIENT_ID`, `SSO_MICROSOFT_CLIENT_SECRET` or `SSO_MICROSOFT_CLIENT_SECRET_FILE`). Partial or invalid configuration logs a boot warning and leaves the provider off. It never blocks startup.
- **Accounts are linked by email**: every email-shaped value in the ID token (`email`, `preferred_username`) is canonicalised and filtered through `DOMAIN_ALLOWLIST`. One matching Kalepin account means sign in; none means create one; several means refuse.
- **`DOMAIN_ALLOWLIST` applies to every login method.** The two copies of the allowlist logic are merged into one helper, and domain matching becomes case-insensitive.
- New public endpoints: `GET /api/auth/providers`, `GET /api/auth/sso/microsoft/start`, and `GET /api/auth/sso/microsoft/callback`. The callback URL is fixed at `APP_URL` + `/api/auth/sso/microsoft/callback`.
- New tables: `sso_login_requests` (single-use, 10-minute, browser-bound sign-in attempts) and `user_identities` (which external identity signed in to which user; observational, email stays authoritative).
- Microsoft's tokens are used once to verify the user, then discarded. No Microsoft Graph access, no refresh tokens, nothing stored.
- `users.displayName` is filled from the provider's `name` claim when it is empty.
- The login page, and therefore the OAuth consent page that embeds it, renders a button for each enabled provider above the magic-link form, and shows SSO errors.
- One post-login redirect builder is shared by magic link and SSO. It puts `?token=` **before** the URL fragment, so hash routes such as `/#/oauth/consent?request_id=…` keep both the token and the route. Today the token is appended after the `#`.
- Documentation: `docs/microsoft-sso.md` (Entra setup how-to), linked from the README configuration table; new variables in `.env.example`.

## Capabilities

### New Capabilities
- `sso-login`: Sign-in through an external identity provider (Microsoft Entra ID first). Covers provider configuration and enablement, the providers endpoint, starting and completing the OIDC flow, tenant pinning, linking accounts by email, recording identities, filling display names, the login-page buttons and errors, and cleanup of login requests.

### Modified Capabilities
- `auth`: The domain allowlist applies to every login method and compares domains case-insensitively. A new post-login redirect requirement keeps the return path, including hash routes, for magic link and SSO alike.
- `oauth-consent-ui`: An unauthenticated user on the consent screen can sign in with any enabled SSO provider, not only the magic link, and returns to the same consent request.
- `e2e-test-harness`: Adds a mock Microsoft identity provider so the SSO flow can be exercised end-to-end without contacting Microsoft.

## Impact

- **Backend**:
  - New `packages/backend/src/auth/sso/` module (config, provider interface, Microsoft provider, account linking, controller, service, sweep).
  - New entities `SsoLoginRequest` and `UserIdentity`, registered in `app.module.ts`.
  - `AuthService` exposes shared user-resolution and session-issuing helpers.
  - The domain-allowlist helper moves out of `comments/` into `auth/`.
  - `auth/verify` uses the shared redirect builder.
- **Frontend**:
  - `LoginPage.tsx` fetches the providers and renders buttons and errors.
  - `auth.ts` gets a providers fetch and the start-URL helper.
  - No change needed in `OAuthConsentPage.tsx`, which embeds `LoginPage`.
- **Dependencies**: `openid-client` ^6, an ESM package loaded from the CommonJS Nest build through Node's `require(esm)` (Node ≥ 20.19 / 22.12; the Docker image runs 22.23).
- **Configuration**: `SSO_MICROSOFT_TENANT_ID`, `SSO_MICROSOFT_CLIENT_ID`, `SSO_MICROSOFT_CLIENT_SECRET`, `SSO_MICROSOFT_CLIENT_SECRET_FILE`, and the optional `SSO_MICROSOFT_AUTHORITY_HOST` (national clouds and tests). Existing deployments are unaffected until they set these.
- **E2E**: A small mock OIDC issuer in `packages/e2e`, wired into the Playwright `webServer` env.
- **Operations**: Entra client secrets expire (at most 24 months). When one lapses, Microsoft sign-in fails and the magic link keeps working; the renewal runbook is in `docs/microsoft-sso.md`.
- **Not changed**: JWT session format and lifetime, API keys, Kalepin's own OAuth authorization server (`auth/oauth/`), the `_secure/` vault and note PINs.
