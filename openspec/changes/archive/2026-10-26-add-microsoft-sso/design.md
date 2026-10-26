## Context

Authentication today (`packages/backend/src/auth/`):

```
LoginPage ─email─▶ POST /api/auth/magic-link ─▶ allowlist? ─▶ magic_link_tokens row ─▶ SMTP
browser ◀─ 302 {returnTo}?token=<JWT> ◀─ GET /api/auth/verify ◀─ click
                                            └─ find-or-create users(email) + ensurePersonalFolder
```

- The whole product is **email-keyed**. `users.email` (canonical, unique) is the identity, and the session JWT carries `{ sub, email }`. Personal folders (`_users/{email}/`), document grants, mentions, the visibility predicate and the access log all key on that email.
- The session JWT is stateless (default 7d) and travels to the SPA as `?token=` on a redirect. `checkTokenFromUrl()` reads `location.search`, stores the token in `localStorage` and strips it from the URL.
- **"oauth" already has a meaning here.** `auth/oauth/`, the `oauth_*` tables and the specs `oauth-authorization-server` / `oauth-consent-ui` all refer to Kalepin acting as an OAuth server for claude.ai MCP connectors. This change is the reverse direction: Kalepin as an OIDC *client*. It is therefore named **SSO** throughout.
- The domain allowlist is implemented twice: `AuthService.isEmailAllowed` and `comments/domain-allowlist.ts`. Neither lower-cases the configured domains.
- The OAuth consent page (`/#/oauth/consent?request_id=…`) embeds `LoginPage` for anonymous users and passes `pathname + search + hash` as `returnTo`. `safeReturnPath` keeps the fragment, and `auth/verify` then appends `?token=` *after* it (`/#/oauth/consent?request_id=X?token=JWT`). `location.search` is empty, so the token is never picked up. This looks like a latent bug in the magic-link-from-consent path, and SSO would inherit it.
- TypeORM runs with `synchronize: true` against an explicit entity list in `app.module.ts`. New tables need no migration but must be registered there.
- The backend compiles to CommonJS (`module: commonjs`). The Docker image runs Node 22.23.
- Kalepin is open source and self-hosted. The motivating deployment has one Entra tenant, and for its users sign-in name (UPN) = mail = the address used for magic links.

## Goals / Non-Goals

**Goals:**
- One-click Microsoft sign-in for users of a single, configured Entra tenant, landing in their existing account.
- Zero behavioural change for deployments that don't configure it.
- `DOMAIN_ALLOWLIST` remains the single gate for every login method.
- A provider seam that keeps a second provider (Google Workspace, generic OIDC) to a new provider class plus configuration.
- The operator setup matches `docs/microsoft-sso.md` exactly (variable names, callback path, warnings, error messages).

**Non-Goals:**
- Replacing or disabling the magic link, including per-domain "SSO required" enforcement.
- Multi-tenant Entra apps, personal Microsoft accounts, or a tenant allowlist.
- Generic OIDC configuration (`SSO_PROVIDERS=…`, arbitrary issuers). The interface is designed for it, but only Microsoft ships.
- Calling Microsoft Graph (avatars, groups, aliases via `proxyAddresses`) or storing Microsoft access/refresh tokens.
- Single logout, session revocation, or shortening the JWT lifetime.
- Merging duplicate accounts, or an admin UI for identities.
- Changing how the session token is handed to the SPA (`?token=` on redirect).

## Decisions

### D1. Architecture: provider returns claims, a shared pipeline decides

```
                      ┌──────────────── auth/sso/ ─────────────────────────────────────────┐
GET /start ──────────▶│ SsoService.start(provider, returnTo)                               │
                      │   ├─ SsoLoginRequest {state, nonce, pkceVerifier, returnTo, ...}   │
                      │   ├─ Set-Cookie kp_sso (binding)                                   │
                      │   └─ provider.authorizationUrl(...) ──302──▶ Microsoft             │
GET /callback ───────▶│ SsoService.complete(provider, url, cookie)                         │
                      │   ├─ consume SsoLoginRequest (state, cookie, ttl, single-use)      │
                      │   ├─ provider.exchange(url, checks) → ExternalIdentity             │
                      │   ├─ resolveAccount(identity, allowlist, users)  (pure)            │
                      │   ├─ create user? record UserIdentity, fill displayName            │
                      │   └─ AuthService.issueSession(user) → buildPostLoginRedirect(...)  │
                      └────────────────────────────────────────────────────────────────────┘
```

```ts
interface IdentityProvider {
  readonly id: string;        // 'microsoft' — used in URLs and user_identities.provider
  readonly label: string;     // 'Microsoft'
  authorizationUrl(p: { redirectUri: string; state: string; nonce: string; codeChallenge: string }): Promise<URL>;
  exchange(p: { callbackUrl: URL; redirectUri: string; state: string; nonce: string; codeVerifier: string }): Promise<ExternalIdentity>;
}

interface ExternalIdentity {
  issuer: string;             // validated iss
  subject: string;            // stable per-person id (Microsoft: oid)
  emails: string[];           // raw candidates, in preference order (Microsoft: email, preferred_username)
  displayName?: string;       // name claim
}
```

A provider owns only the protocol and its own trust checks (Microsoft: the `tid` pin). Everything that decides *which Kalepin user* a person becomes lives in the shared pipeline: canonicalising, the allowlist, linking, creation, the session and the redirect. A second provider therefore can't forget the allowlist.

*Alternatives:* `@nestjs/passport` with `passport-azure-ad` (archived by Microsoft, and the codebase uses its own guards, not passport). A Microsoft-only service with no interface (cheaper now, but the "add more providers" requirement is explicit).

### D2. OIDC library: `openid-client` v6

It handles discovery, PKCE (S256), state and nonce checks, ID token signature validation with JWKS fetching and key rotation, and `iss`/`aud`/`exp` checks. Hand-rolling these against Microsoft's rotating keys is where bugs hide. The package is ESM-only; the CommonJS Nest build loads it through Node's `require(esm)` (unflagged since 20.19 / 22.12), and its top-level `types` field resolves under the backend's default module resolution. **The first implementation task is a spike** that proves `import * as oidc from 'openid-client'` builds with `nest build` and runs both under `node dist/...` and `node --test`.

*Fallback if the spike fails:* `jsonwebtoken` (already a dependency) plus `jwks-rsa` (CommonJS) for ID token validation, with a hand-written authorization URL and token exchange via `fetch`. Same interface, more code to review.

### D3. Tenant pinning and configuration gating

- The authority is `${SSO_MICROSOFT_AUTHORITY_HOST ?? 'https://login.microsoftonline.com'}/${tenantId}/v2.0`. Discovery is fetched from it, which pins the expected `iss`. After the exchange, the Microsoft provider also requires `claims.tid` to equal the configured tenant ID (case-insensitive GUID comparison), or it fails with `wrong_tenant`.
- `SSO_MICROSOFT_TENANT_ID` must be a GUID. This refuses `common`, `organizations` and `consumers` (multi-tenant endpoints, where any tenant's admin can mint an `email` claim for your domain, the "nOAuth" pattern). It also refuses domain-style tenant names like `contoso.onmicrosoft.com`, because the `tid` comparison needs the GUID.
- `SSO_MICROSOFT_CLIENT_ID` must be a GUID.
- The secret comes from `SSO_MICROSOFT_CLIENT_SECRET_FILE` (read once at boot and trimmed; no file-mode check, since Swarm mounts secrets as 0444) or `SSO_MICROSOFT_CLIENT_SECRET`. When both are set, the file wins and a warning is logged, matching the `KALEPIN_KEK*` precedence.
- `SSO_MICROSOFT_AUTHORITY_HOST` is optional, for national clouds (`https://login.microsoftonline.us`, …) and for e2e. It must be `https://`, except `http://localhost` / `http://127.0.0.1`, which enables openid-client's insecure-request option for that host only.
- Configuration is parsed once at boot by a pure `parseSsoConfig(env)` that returns `{ providers, warnings }`:

| Env state | Result |
|---|---|
| no `SSO_MICROSOFT_*` set | provider off, no log |
| all valid | provider on; `INFO SSO: Microsoft sign-in enabled for tenant <guid>` |
| some set, some missing | provider off; `WARN SSO_MICROSOFT: missing <VAR>[, <VAR>]` |
| tenant not a GUID (incl. multi-tenant values) | provider off; `WARN SSO_MICROSOFT: SSO_MICROSOFT_TENANT_ID must be your tenant's GUID; multi-tenant values (common, organizations, consumers) are not supported` |
| client ID not a GUID / unreadable secret file / bad authority host | provider off; WARN naming the variable |

- SSO misconfiguration **never** prevents boot, because the magic link must keep working.
- OIDC discovery runs lazily on the first `/start` and is cached in memory, with a retry on the next request if it failed. A Microsoft outage therefore never affects boot or the magic link.

*Alternative:* fail fast on partial configuration, like `JWT_SECRET`. Rejected: SSO is a convenience, and a typo in it shouldn't take the whole workspace down.

### D4. Login request state: DB row + browser-binding cookie

`sso_login_requests` (entity `SsoLoginRequest`):

| column | notes |
|---|---|
| `state` | 32 random bytes, base64url; unique; the lookup key |
| `provider` | `'microsoft'` |
| `nonce` | 32 random bytes, base64url |
| `codeVerifier` | PKCE verifier (server-side only) |
| `bindingHash` | sha256 of the cookie value |
| `returnTo` | already passed through `safeReturnPath` |
| `expiresAt` | now + 10 min |
| `usedAt` | null until consumed |
| `createdAt` | |

- **Start:** create the row, then set the cookie `kp_sso=<32 random bytes base64url>` with `HttpOnly; SameSite=Lax; Path=/api/auth/sso; Max-Age=600`, plus `Secure` when the request is HTTPS (`trust proxy` is already on).
- **Callback:** look the row up by `state`. It must exist, match the provider, have `usedAt` null, be unexpired, and its `bindingHash` must match sha256(cookie) under a timing-safe comparison. Mark `usedAt` **before** the code exchange (single-use, even if the exchange fails), then clear the cookie. Any failure maps to `expired`.
- **Why the cookie:** without it, an attacker can start a flow, sign in as themselves, and get a victim to open the resulting callback URL ("login CSRF"); the victim would then be working inside the attacker's account. Binding the request to the browser that started it closes that.
- **`response_mode=query`** (the default for the code flow) arrives as a top-level GET, so the `SameSite=Lax` cookie is sent. `form_post` would need `SameSite=None`.
- *Trade-off:* a single cookie name means two simultaneous attempts in one browser leave only the latest valid. The other shows "Sign-in expired, please try again". Accepted.
- **Cleanup:** an in-process 5-minute interval deletes rows where `expiresAt < now - 1h` or `usedAt` is set. This follows `OAuthSweepService`.
- **Rate limits:** `/start` is limited to 20/min per IP (it creates rows) and `/callback` to 30/min per IP, both with `SlidingWindowRateLimiter`.
- *Alternative:* a signed or encrypted cookie holding all the state (stateless). Rejected for consistency with `magic_link_tokens` / `oauth_authorization_requests`, and because single-use is trivial with a row.

### D5. Authorization request parameters

`scope=openid email profile`, `response_type=code`, `code_challenge_method=S256`, `state`, `nonce`, `prompt=select_account`, and `redirect_uri` = the configured callback URL.

`prompt=select_account` matters because Kalepin logout doesn't sign the user out of Microsoft. Without it, clicking the button after logging out would silently sign the same account back in, with no chance to pick another.

No `offline_access` and no Graph scopes: Kalepin only needs the ID token. The access token and ID token are dropped once the identity has been extracted. Nothing from Microsoft is persisted except `user_identities` (issuer, subject, the email at link time).

### D6. Callback URL derivation

`redirectUri = APP_URL.replace(/\/+$/, '') + '/api/auth/sso/microsoft/callback'` is computed once at boot. The same string is sent on the authorize request and the token exchange, and is what operators register in Entra.

The `callbackUrl` given to openid-client is built from `redirectUri` + the request's query string, **never** from `req.protocol`/`req.host`. Behind a TLS-terminating proxy those can disagree with what Microsoft redirected to, and the existing `app-url-warning` already covers that mismatch.

### D7. Account resolution (pure function)

```
resolveAccount(identity.emails, allowlist, findUsersByEmails) →
  candidates = emails → canonicalizeEmail (drop throws) → keep allowlisted → dedupe (keep order)
  candidates empty                → { outcome: 'domain_not_allowed' }
  users = existing users whose email ∈ candidates
  users.length == 1               → { outcome: 'existing', user }
  users.length == 0               → { outcome: 'create', email: candidates[0] }   // email claim first, else preferred_username
  users.length >= 2               → { outcome: 'ambiguous', userIds }            // WARN log; no session
```

- Email is authoritative, per the requirement that existing accounts link by email. `user_identities` is **not** consulted for resolution.
- Microsoft emits `preferred_username` as the UPN, which can be a non-email for some account types. `canonicalizeEmail` throwing just drops that candidate.
- Aliases (`proxyAddresses`) aren't in the ID token and are out of scope (no Graph). Someone who signed up through an alias gets a new account. This is documented, and the magic link keeps working for them.
- Domain matching uses the unified helper (D10).

### D8. Identity record (`user_identities`)

| column | notes |
|---|---|
| `id` | |
| `userId` | FK to `users.id` |
| `provider` | |
| `issuer` | |
| `subject` | Microsoft `oid` |
| `emailAtLink` | |
| `createdAt` | |
| `lastLoginAt` | |

Unique on (`provider`, `issuer`, `subject`).

After a successful resolution, upsert by (`provider`, `issuer`, `subject`):
- **New:** insert.
- **Same user:** update `lastLoginAt`.
- **Different user** (the person's email changed, or the address was reassigned): `WARN SSO identity <provider>/<subject> moved from user <a> to user <b>`, then re-point `userId` and update `emailAtLink` and `lastLoginAt`.

A user can have several identities (a future second provider; a recycled address getting a new `oid` logs an INFO). In v1 nothing blocks on identity mismatches, which matches the magic link: whoever controls the address controls the account. The table exists so a later change can do rename detection, a "connected accounts" view, or blocking, without a backfill.

*Alternative:* resolve by identity first, then by email. Rejected for v1: the session JWT carries the email, and following an `oid` to a user whose stored email differs from the token's would create a hidden email/identity split across the whole email-keyed system.

### D9. Display name

If the resolved user has no `displayName` and the identity has a non-empty `name`, set `displayName` to `name` (trimmed, at most 200 chars). An existing value is never overwritten.

### D10. One allowlist helper

Move `parseDomainAllowlist` / `isEmailDomainAllowed` to `auth/domain-allowlist.ts` and import them from `AuthService`, `NotificationService` and the SSO pipeline. `comments/domain-allowlist.ts` is removed, not left as a re-export, to avoid a third copy.

Parsing lower-cases and trims entries and drops empty ones. Matching compares the lower-cased domain part. `*` keeps its meaning.

This is a small behaviour change: `DOMAIN_ALLOWLIST=Example.com` used to match nothing, because emails are canonicalised to lower case, and now matches `@example.com`.

### D11. Post-login redirect builder (shared)

`buildPostLoginRedirect(returnTo: unknown, sessionToken: string): string`, in `auth/return-to.ts`:

1. `path = safeReturnPath(returnTo)`
2. split into `before#` and `#fragment`
3. add `token` to the query of `before#` with `URLSearchParams`, keeping existing query params
4. reattach the fragment

So `/#/oauth/consent?request_id=X` becomes `/?token=JWT#/oauth/consent?request_id=X`. `checkTokenFromUrl` already removes `token` from `search` and keeps the hash.

Both `GET /api/auth/verify` and the SSO callback use it. SSO error redirects use the same placement with `sso_error=<code>` instead of `token`, targeting the request's `returnTo` when known and `/` otherwise.

### D12. HTTP surface

| Route | Auth | Behaviour |
|---|---|---|
| `GET /api/auth/providers` | public | `200 { providers: [{ id: 'microsoft', label: 'Microsoft' }] }`, or `{ providers: [] }` |
| `GET /api/auth/sso/:provider/start?returnTo=` | public | unknown or disabled provider → 404; rate limited; otherwise 302 to the IdP, plus the cookie |
| `GET /api/auth/sso/:provider/callback` | public | always a 302 into the SPA: success → `returnTo` with `?token=`; failure → `returnTo` or `/` with `?sso_error=` |

Error codes sent to the SPA (the raw IdP `error_description` is logged, never forwarded):

| code | when | message on the login page |
|---|---|---|
| `domain_not_allowed` | no allowlisted candidate | "Email domain not allowed" |
| `wrong_tenant` | `tid` mismatch | "Account from another organisation" |
| `ambiguous_account` | ≥ 2 users matched | "Several Kalepin accounts match this Microsoft account. Use the email link instead, or ask an admin." |
| `expired` | state unknown/used/expired, cookie missing or mismatched | "Sign-in expired, please try again" |
| `cancelled` | IdP returned `error=access_denied` | "Sign-in was cancelled" |
| `provider_error` | any other IdP error, exchange failure (e.g. `AADSTS7000215` / `AADSTS7000222` secret problems), ID token validation failure | "Microsoft sign-in failed. Try again, or use the email link." |
| `unavailable` | discovery unreachable at `/start` | "Microsoft sign-in is temporarily unavailable" (redirect to `/` + `returnTo`) |

### D13. Frontend

- `auth.ts` gains `fetchAuthProviders()` and `ssoStartUrl(providerId, returnTo)`.
- `LoginPage` fetches the providers on mount. A failure is treated as an empty list, so the magic-link form still renders. For each provider it renders a "Sign in with {label}" button above the form, then an "or" divider.
- The click is a **full-page navigation** (`window.location.assign`), not a `<form>`: CSP `form-action 'self'` is enforced on redirects after a form submit in Chromium, which would block the 302 to `login.microsoftonline.com`.
- `returnTo` is the same `pathname + search + hash` the magic link uses today, so `OAuthConsentPage` gets SSO without changes.
- `LoginPage` reads `sso_error` from `location.search`, shows the mapped message in the existing `.login-error` slot, and strips the parameter with `history.replaceState`.

### D14. Testing

- **Unit (`node --test` on the Nest build):**
  - `parseSsoConfig` (each row of the D3 table)
  - `resolveAccount` (every outcome, non-email UPN, allowlist filtering, dedupe, ordering)
  - the domain-allowlist helper (case, whitespace, `*`)
  - `buildPostLoginRedirect` (plain path, existing query, hash route, hostile `returnTo`)
  - login-request consumption (unknown, expired, used, provider mismatch, cookie mismatch, single-use under a failed exchange)
  - Microsoft `tid` check
  - identity upsert and the re-point warning
- **E2E:**
  - **Mock issuer:** `packages/e2e/mock-oidc-issuer.ts`, a small HTTP server using `node:crypto` (RSA key pair, JWK export) and `jsonwebtoken` (RS256 signing), both already available to the e2e package, so there's no new dependency. It serves `/{tenant}/v2.0/.well-known/openid-configuration`, JWKS, an `/authorize` that immediately redirects back with a code for a test-selected identity (via a query hint or a `POST /__set-identity`), and `/token`.
  - **Wiring:** the backend `webServer` env sets `SSO_MICROSOFT_*` with `SSO_MICROSOFT_AUTHORITY_HOST=http://localhost:<port>`.
  - **Specs:**
    - button visible
    - existing user lands in their account
    - a new user is created
    - a disallowed domain shows the error
    - consent page → SSO → back on the same consent request
    - consent page → magic link (token read from `magic_link_tokens` in the e2e SQLite DB via `better-sqlite3`) → back on consent, the D11 regression
    - `wrong_tenant` from a mock token with a foreign `tid`

## Risks / Trade-offs

- **`openid-client` is ESM-only and the backend is CommonJS.** → Spike first (D2). The fallback (`jsonwebtoken` + `jwks-rsa`) is pre-chosen so it doesn't block the change.
- **Linking by email trusts the tenant's admins to set addresses honestly.** → Single tenant only, `tid` pinned, multi-tenant values refused (D3). This is the same trust model as the magic link, whose mailboxes those admins also control.
- **Alias sign-ups get a second, empty account on first SSO use.** → Documented. The magic link still works for them, and an admin can merge manually. Fixing it would need Graph (out of scope).
- **An expired Entra client secret silently breaks SSO.** → The magic link keeps working; the exchange failure is logged with the `AADSTS` code; the renewal runbook is in the docs. A future `system-health-view` entry could surface it.
- **Offboarding:** disabling a user in Entra blocks new SSO sign-ins, but existing Kalepin JWTs stay valid for up to `JWT_EXPIRY` (7d). → Unchanged from today, out of scope, documented as expected.
- **The session JWT still travels in the URL query** (history, proxy logs). → Unchanged from the magic link. `Referrer-Policy: same-origin` and the immediate `replaceState` limit exposure. A code-for-token exchange is a possible follow-up.
- **Guest (B2B) users** invited into the tenant receive tokens with the home tenant's `tid` and their own external email. → They can sign in only if their domain is allowlisted. Documented; no `acct`-claim filter in v1.
- **One `kp_sso` cookie per browser.** → Parallel attempts invalidate each other with a clear "expired" message. Accepted.
- **Case-insensitive allowlist** changes behaviour for mixed-case `DOMAIN_ALLOWLIST` values. → Strictly more permissive, and only for entries that were silently matching nothing. Called out in the CHANGELOG.

## Migration Plan

1. Deploy. New tables are created by `synchronize`. With no `SSO_MICROSOFT_*` set nothing changes, apart from the allowlist case fix and the hash-route redirect fix.
2. The operator follows `docs/microsoft-sso.md` (app registration, admin consent, three variables) and restarts.
3. Check the boot log for `SSO: Microsoft sign-in enabled`, then sign in from a private window.
4. **Rollback:** unset the `SSO_MICROSOFT_*` variables and restart. The button disappears, sessions already issued stay valid, and the `user_identities` / `sso_login_requests` tables are inert. A code rollback leaves two unused tables behind, which is harmless.

## Open Questions

- None blocking. Possible follow-ups, not part of this change: an `acct` (guest) filter, enforcing SSO per domain, a "connected accounts" view, surfacing SSO health (discovery reachable, last exchange error) in `system-health-view`, and replacing `?token=` with a one-time login code.
