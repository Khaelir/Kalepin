## MODIFIED Requirements

### Requirement: Consent flow handles unauthenticated users

If the consent screen loads while the user has no active session, it SHALL show the existing login form inline: the magic-link form, plus a button for each enabled SSO provider. After a successful login by any method, the user SHALL return to the same consent request without losing the `request_id`.

#### Scenario: Anonymous user lands on consent
- **WHEN** an unauthenticated user navigates to `/#/oauth/consent?request_id=<id>`
- **THEN** the SPA renders the magic-link form; on success the user is returned to the consent screen for the same `request_id`

#### Scenario: Anonymous user signs in with an SSO provider from consent
- **WHEN** an unauthenticated user on `/#/oauth/consent?request_id=<id>` clicks "Sign in with Microsoft" and completes the sign-in
- **THEN** the user is returned, authenticated, to the consent screen for the same `request_id`

#### Scenario: SSO error on consent
- **WHEN** an SSO sign-in started from the consent screen fails
- **THEN** the user is returned to the consent screen for the same `request_id`, still unauthenticated, with the SSO error message shown above the login form
