## Purpose

Authenticates users via magic link emails restricted to an allowed domain list, issuing JWT session tokens.

## Requirements

### Requirement: Magic link login
The system SHALL authenticate users via magic link emails. The user enters their email address, receives a link with a short-lived JWT token, and clicking it issues a session JWT.

#### Scenario: Successful login
- **WHEN** a user submits an email matching the domain allowlist
- **THEN** the system sends a magic link email via Mailjet SMTP containing a JWT token with short expiry (e.g., 15 minutes)

#### Scenario: User clicks valid magic link
- **WHEN** a user clicks a magic link with a valid, unexpired token
- **THEN** the system issues a session JWT and redirects to the workspace

#### Scenario: Expired magic link
- **WHEN** a user clicks a magic link with an expired token
- **THEN** the system displays an error and prompts the user to request a new link

### Requirement: Domain allowlist
The system SHALL restrict login to email addresses matching a configurable domain allowlist.

#### Scenario: Email matches allowlist
- **WHEN** a user submits an email with a domain in the allowlist (e.g., `@company.com`)
- **THEN** the system proceeds with sending the magic link

#### Scenario: Email does not match allowlist
- **WHEN** a user submits an email with a domain not in the allowlist
- **THEN** the system rejects the request with an appropriate error message

### Requirement: JWT session management
The system SHALL use JWT tokens for session management with configurable expiry. Tokens MUST be sent in the Authorization header for REST requests and in the WebSocket upgrade request.

#### Scenario: Valid session token
- **WHEN** a request includes a valid, unexpired JWT in the Authorization header
- **THEN** the system processes the request with the authenticated user context

#### Scenario: Expired session token
- **WHEN** a request includes an expired JWT
- **THEN** the system returns a 401 response

#### Scenario: WebSocket authentication
- **WHEN** a client initiates a WebSocket upgrade with a valid JWT
- **THEN** the system upgrades the connection and associates it with the authenticated user

#### Scenario: WebSocket with invalid token
- **WHEN** a client initiates a WebSocket upgrade with an invalid or missing JWT
- **THEN** the system rejects the upgrade with a 401 status
