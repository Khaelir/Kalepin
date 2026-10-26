## MODIFIED Requirements

### Requirement: Domain allowlist
The system SHALL restrict login, by every login method (magic link and SSO), to email addresses matching a configurable domain allowlist (`DOMAIN_ALLOWLIST`). Allowlist entries SHALL be trimmed and compared case-insensitively against the domain part of the canonical email; `*` SHALL allow any domain. A single allowlist implementation SHALL serve login and mention notifications.

#### Scenario: Email matches allowlist
- **WHEN** a user submits an email with a domain in the allowlist (e.g., `@company.com`)
- **THEN** the system proceeds with sending the magic link

#### Scenario: Email does not match allowlist
- **WHEN** a user submits an email with a domain not in the allowlist
- **THEN** the system rejects the request with an appropriate error message

#### Scenario: Mixed-case allowlist entry
- **WHEN** `DOMAIN_ALLOWLIST` is ` Company.com ` and a user submits `alice@company.com`
- **THEN** the system proceeds with sending the magic link

#### Scenario: SSO identity outside the allowlist
- **WHEN** an SSO sign-in yields only email addresses whose domains are not in the allowlist
- **THEN** the system refuses the sign-in and issues no session

## ADDED Requirements

### Requirement: Post-login redirect preserves the return path
After any successful login (magic link or SSO), the system SHALL redirect to the sanitised return path with the session token added as a `token` query parameter placed before any URL fragment, keeping the path, the existing query parameters and the fragment intact.

#### Scenario: Plain path
- **WHEN** a login completes with return path `/doc/Notes.md`
- **THEN** the browser is redirected to `/doc/Notes.md?token=<JWT>`

#### Scenario: Path with existing query
- **WHEN** a login completes with return path `/search?q=plan`
- **THEN** the browser is redirected to `/search?q=plan&token=<JWT>`

#### Scenario: Hash route
- **WHEN** a login completes with return path `/#/oauth/consent?request_id=abc`
- **THEN** the browser is redirected to `/?token=<JWT>#/oauth/consent?request_id=abc`, and the SPA stores the token and removes it from the URL while keeping the fragment

#### Scenario: Hostile return path
- **WHEN** the return path is `//evil.example/` or `/\evil.example/`
- **THEN** the browser is redirected to `/?token=<JWT>`
