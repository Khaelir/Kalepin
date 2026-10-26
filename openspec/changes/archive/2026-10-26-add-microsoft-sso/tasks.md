## 1. Spike: OIDC library in the CommonJS build

- [x] 1.1 Add `openid-client@^6` to `packages/backend/package.json` and install
- [x] 1.2 Throwaway check: `import * as oidc from 'openid-client'` in a backend file type-checks, `npx nest build` succeeds, and `node dist/backend/src/main.js` plus a `node --test` file both load it (require(esm) on Node 22.x)
- [x] 1.3 (Not needed: the 1.2 spike passed on Node 22.20, 22.23.4 in Docker, and 25.) If 1.2 fails, switch to the design D2 fallback (`jsonwebtoken` + `jwks-rsa`, hand-written authorize URL and token exchange) and record the decision in design.md before continuing

## 2. Shared auth groundwork

- [x] 2.1 Move `parseDomainAllowlist` / `isEmailDomainAllowed` to `auth/domain-allowlist.ts`, lower-case and trim entries, drop empty entries, and compare the lower-cased domain; delete `comments/domain-allowlist.ts`
- [x] 2.2 Switch `AuthService.isEmailAllowed` and `NotificationService` to the shared helper; unit tests for case, whitespace, `*` and an empty allowlist
- [x] 2.3 Add `buildPostLoginRedirect(returnTo, params)` to `auth/return-to.ts`: sanitise with `safeReturnPath` and insert query params before the fragment; unit tests for plain path, existing query, hash route and hostile inputs
- [x] 2.4 Use `buildPostLoginRedirect` in `GET /api/auth/verify` (fixes the magic-link → `/#/oauth/consent` hand-off)
- [x] 2.5 Expose `AuthService` helpers for SSO: `findUsersByEmails(emails)`, `createUser(email)`, `issueSession(user)` (signs the existing JWT payload), and make `ensurePersonalFolderSafe` callable from the SSO service; magic-link behaviour unchanged

## 3. Data model

- [x] 3.1 Create the `SsoLoginRequest` entity (`sso_login_requests`): unique `state`, `provider`, `nonce`, `codeVerifier`, `bindingHash`, `returnTo`, `expiresAt`, nullable `usedAt`, `createdAt`
- [x] 3.2 Create the `UserIdentity` entity (`user_identities`): `userId` FK, `provider`, `issuer`, `subject`, `emailAtLink`, `createdAt`, `lastLoginAt`; unique (`provider`, `issuer`, `subject`)
- [x] 3.3 Export both from `entities/index.ts` and add them to the explicit entity list in `app.module.ts`; confirm `synchronize` creates both tables on a fresh DB and on a copy of an existing one

## 4. SSO configuration

- [x] 4.1 `auth/sso/sso-config.ts`: pure `parseSsoConfig(env)` returning `{ microsoft?: { tenantId, clientId, clientSecret, authorityHost, redirectUri }, warnings[] }`, covering the design D3 table (no config, complete, partial, non-GUID / multi-tenant tenant, non-GUID client, unreadable secret file, both secret sources, insecure authority host); `redirectUri` derived from `APP_URL` with trailing slashes trimmed
- [x] 4.2 Unit tests for every row of the D3 table, including the exact warning texts that `docs/microsoft-sso.md` refers to
- [x] 4.3 Log the warnings once at boot, plus the INFO line when enabled; never throw

## 5. Provider seam and Microsoft provider

- [x] 5.1 `auth/sso/identity-provider.ts`: `IdentityProvider` and `ExternalIdentity` interfaces (design D1) and an `SsoError` type carrying the `sso_error` code
- [x] 5.2 `auth/sso/providers/microsoft.provider.ts`: lazy, cached discovery from `{authorityHost}/{tenantId}/v2.0` with retry on next use after a failure; insecure requests allowed only for a localhost authority
- [x] 5.3 `authorizationUrl()`: code flow, S256 challenge, `scope=openid email profile`, `prompt=select_account`, `state`, `nonce`, `redirect_uri`
- [x] 5.4 `exchange()`: build the callback URL from `redirectUri` + request query (never `req.host`); map `error=access_denied` → `cancelled` and other IdP errors or exchange failures → `provider_error` (log the AADSTS code and description); validate the ID token through the library (signature, iss, aud, exp, nonce)
- [x] 5.5 Enforce `tid` == configured tenant (case-insensitive) → `wrong_tenant`; map claims to `ExternalIdentity` (`emails: [email, preferred_username]` minus absent ones, `subject: oid`, `displayName: name`); discard all tokens
- [x] 5.6 Unit tests for the claim mapping and the `tid` check (matching, mismatched, missing `tid`, missing `email`, missing `oid`)

## 6. Account resolution and identity recording

- [x] 6.1 `auth/sso/account-linking.ts`: pure `resolveAccount(emails, allowlist, existingUsers)` → `existing` / `create` / `ambiguous` / `domain_not_allowed` (design D7)
- [x] 6.2 Unit tests: match by `email`, match by `preferred_username` only, create (email first, then UPN fallback), two users → ambiguous, non-email UPN dropped, case/whitespace canonicalisation, nothing allowlisted, duplicate candidates
- [x] 6.3 Identity upsert (design D8): insert, update `lastLoginAt`, re-point with a WARN on a user change; unit tests
- [x] 6.4 Display-name fill (design D9): only when empty, trimmed, at most 200 chars; unit tests

## 7. SSO service, controller and module

- [x] 7.1 `auth/sso/sso.service.ts` `start(providerId, returnTo)`: random state/nonce/verifier/binding, store the `SsoLoginRequest` (returnTo via `safeReturnPath`, 10-minute expiry, sha256 binding), return the authorization URL and the cookie value; discovery failure → `unavailable`
- [x] 7.2 `SsoService.complete(providerId, query, cookie)`: consume the request (exists, same provider, unused, unexpired, timing-safe binding check, mark `usedAt` before the exchange) → `exchange` → `resolveAccount` → create the user if needed → `ensurePersonalFolder` → identity upsert → display-name fill → `issueSession`; WARN log on `ambiguous`
- [x] 7.3 Unit tests for consumption: unknown state, expired, already used, provider mismatch, missing or mismatched cookie, and single-use even when the exchange throws
- [x] 7.4 `auth/sso/sso.controller.ts`: `GET /api/auth/providers`; `GET /api/auth/sso/:provider/start` (404 when unknown or disabled, sets the `kp_sso` cookie with `HttpOnly; SameSite=Lax; Path=/api/auth/sso; Max-Age=600`, plus `Secure` when HTTPS, 302); `GET /api/auth/sso/:provider/callback` (reads the cookie from the `Cookie` header, clears it, 302 via `buildPostLoginRedirect` with `token` or `sso_error`, falling back to `/` when the returnTo is unknown)
- [x] 7.5 Rate limits with `SlidingWindowRateLimiter`: start 20/min/IP, callback 30/min/IP
- [x] 7.6 Sweep: 5-minute interval deleting used requests and requests expired more than 1 hour ago; cleared on module destroy
- [x] 7.7 `auth/sso/sso.module.ts` wired into `AuthModule` / `app.module.ts`; INFO log on successful SSO sign-in (provider, user id)
- [x] 7.8 Controller-level test: `GET /api/auth/providers` returns `[]` with no config and `[{ id: 'microsoft', label: 'Microsoft' }]` with full config

## 8. Frontend

- [x] 8.1 `auth.ts`: `fetchAuthProviders()` (errors → `[]`) and `ssoStartUrl(providerId, returnTo)`
- [x] 8.2 `LoginPage.tsx`: fetch providers on mount; render "Sign in with {label}" buttons above the form with an "or" divider; click → `window.location.assign(ssoStartUrl(id, pathname + search + hash))` (no `<form>`, because of CSP `form-action`)
- [x] 8.3 `LoginPage.tsx`: read `sso_error` from `location.search`, map it to the design D12 messages (unknown codes → the generic message), show it in `.login-error`, strip it with `history.replaceState` (keeping the hash)
- [x] 8.4 Styles for the provider button and divider in `styles.css`, matching the existing login card (light and dark)
- [x] 8.5 Confirm `OAuthConsentPage` shows the button with no code change, and that `checkTokenFromUrl` handles `/?token=…#/oauth/consent?…`

## 9. E2E harness and specs

- [x] 9.1 `packages/e2e/mock-oidc-issuer.ts`: an HTTP server with an RSA key pair (`node:crypto`), JWKS, discovery at `/{tenant}/v2.0/.well-known/openid-configuration`, `/authorize` redirecting back with a code (validating `redirect_uri`, keeping `state`/`nonce`/`code_challenge`), `/token` verifying PKCE and returning an RS256 ID token (`jsonwebtoken`), and a way for tests to set the next identity
- [x] 9.2 Start the mock from the Playwright config (a `webServer` entry or global setup) and add `SSO_MICROSOFT_TENANT_ID`, `SSO_MICROSOFT_CLIENT_ID`, `SSO_MICROSOFT_CLIENT_SECRET` and `SSO_MICROSOFT_AUTHORITY_HOST` to the backend env; set `APP_URL` so the callback hits the backend
- [x] 9.3 `tests/sso-microsoft.spec.ts`: button visible; existing user signs in to their account (a personal note seeded beforehand is visible); new user created; disallowed domain → error message; foreign `tid` → "Account from another organisation"; cancelled → message
- [x] 9.4 Consent round-trips: consent → Microsoft → same consent `request_id`, authenticated; consent → magic link (token read from `magic_link_tokens` with `better-sqlite3`) → same consent `request_id`, authenticated
- [x] 9.5 Existing suites unaffected: the login page now shows a button, but fixtures that set `kalepin_token` still pass

## 10. Docs and configuration

- [x] 10.1 README: add the `SSO_MICROSOFT_*` rows to the Configuration table linking to `docs/microsoft-sso.md`; add "Microsoft sign-in (optional)" to the Features / Tech stack auth line
- [x] 10.2 `.env.example`: commented `SSO_MICROSOFT_TENANT_ID`, `SSO_MICROSOFT_CLIENT_ID`, `SSO_MICROSOFT_CLIENT_SECRET_FILE`, `SSO_MICROSOFT_CLIENT_SECRET` and `SSO_MICROSOFT_AUTHORITY_HOST`, with a one-line pointer to the doc
- [x] 10.3 Reconcile `docs/microsoft-sso.md` with the implementation: warning texts, error messages, callback path and variable names
- [x] 10.4 CHANGELOG entry: Microsoft sign-in, the case-insensitive `DOMAIN_ALLOWLIST`, and the fixed magic-link return to the OAuth consent page

## 11. Verification

- [x] 11.1 Backend unit tests: `npx nest build` then `node --test` on the new and touched test files, all green
- [x] 11.2 Full e2e suite: green, apart from the known baseline failures (stage2-contract share-link, watcher-tmp-filter personal), which must be confirmed as pre-existing
- [x] 11.3 Boot with no `SSO_MICROSOFT_*` set: no SSO log line, `/api/auth/providers` returns `[]`, the login page matches today's
- [ ] 11.4 A real deployment with a real Entra app (`<APP_URL>/api/auth/sso/microsoft/callback`): sign in as an existing magic-link user and land in the same account with the same personal folder; check that `user_identities` has the row, that the display name was filled if it was empty, and that no Microsoft tokens are in the DB or logs
