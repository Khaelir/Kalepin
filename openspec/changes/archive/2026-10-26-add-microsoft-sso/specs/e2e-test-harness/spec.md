## ADDED Requirements

### Requirement: Mock Microsoft identity provider
The test harness SHALL run a local mock OpenID Connect issuer that imitates the Microsoft Entra v2.0 endpoints (discovery under `/{tenant}/v2.0`, JWKS, authorize, token) and SHALL start the backend with `SSO_MICROSOFT_*` pointing at it via `SSO_MICROSOFT_AUTHORITY_HOST`. Tests SHALL be able to choose the identity (email, `preferred_username`, `oid`, `tid`, `name`) that the next authorization returns, without contacting Microsoft.

#### Scenario: SSO sign-in in e2e
- **WHEN** a test selects the identity `alice@example.com` and clicks "Sign in with Microsoft"
- **THEN** the mock issuer immediately redirects back with a code, the backend exchanges it for an RS256-signed ID token from the mock, and the browser lands authenticated as `alice@example.com`

#### Scenario: Foreign tenant in e2e
- **WHEN** a test selects an identity whose `tid` differs from the configured tenant
- **THEN** the sign-in is refused with the "Account from another organisation" message
