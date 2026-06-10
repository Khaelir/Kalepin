## ADDED Requirements

### Requirement: Protected resource metadata endpoint

The system SHALL expose `GET /.well-known/oauth-protected-resource` (RFC 9728) at the resource server origin, returning JSON describing how to obtain credentials for the MCP endpoint. The endpoint SHALL be publicly accessible without authentication.

#### Scenario: Fetch resource metadata
- **WHEN** a client sends `GET /.well-known/oauth-protected-resource`
- **THEN** the system returns 200 with `Content-Type: application/json` and a body including at least `{ "resource": "<base_url>/mcp", "authorization_servers": ["<base_url>"], "scopes_supported": ["notes.read", "notes.comment", "notes.write"], "bearer_methods_supported": ["header"], "resource_documentation": "<base_url>/docs/mcp" }`

#### Scenario: No authentication required
- **WHEN** a client requests resource metadata without an Authorization header
- **THEN** the system returns 200 (the endpoint is public)

### Requirement: Authorization server metadata endpoint

The system SHALL expose `GET /.well-known/oauth-authorization-server` (RFC 8414) at the authorization-server origin, returning JSON describing the OAuth endpoints and capabilities. The endpoint SHALL be publicly accessible without authentication.

#### Scenario: Fetch AS metadata
- **WHEN** a client sends `GET /.well-known/oauth-authorization-server`
- **THEN** the system returns 200 with a JSON body that includes at minimum: `issuer`, `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, `registration_endpoint`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code", "refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none", "client_secret_post"]`, `scopes_supported`

#### Scenario: HTTPS URLs
- **WHEN** the metadata is served over HTTPS
- **THEN** every URL field in the response uses `https://` (an HTTP fallback is permitted only when the server is bound to localhost for development)

### Requirement: WWW-Authenticate challenge advertises metadata location

The MCP endpoint SHALL respond to unauthenticated requests with `401 Unauthorized` and a `WWW-Authenticate` header pointing to the resource metadata, so MCP clients can discover the AS automatically.

#### Scenario: Unauthenticated MCP request
- **WHEN** a client sends `POST /mcp` without an Authorization header
- **THEN** the response is `401 Unauthorized` with header `WWW-Authenticate: Bearer realm="kalepin", resource_metadata="<base_url>/.well-known/oauth-protected-resource"`

#### Scenario: Invalid token
- **WHEN** a client sends `POST /mcp` with an invalid bearer token
- **THEN** the response is `401 Unauthorized` with header `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<base_url>/.well-known/oauth-protected-resource"`

### Requirement: Metadata reflects deployment URL

The discovery metadata SHALL reflect the actual public URL of the deployment, derived from `APP_URL` (or equivalent) configuration, not hardcoded.

#### Scenario: Different deployment hostnames
- **WHEN** the server is deployed at `https://kalepin.example.com` and `APP_URL` is set accordingly
- **THEN** all URLs returned in `/.well-known/*` responses begin with `https://kalepin.example.com`

### Requirement: Boot-time warning for proxy/APP_URL mismatch

The system SHALL log a high-visibility warning when the protocol or host advertised by `APP_URL` does not match the protocol/host observed in incoming requests via `X-Forwarded-Proto` and `X-Forwarded-Host` (the headers set by Traefik and other reverse proxies). The check SHALL run after a brief observation period (e.g. on the first inbound request after startup, repeated at most once per minute) so transient misconfiguration is surfaced quickly without log spam.

#### Scenario: Protocol mismatch behind Traefik
- **WHEN** `APP_URL=http://kalepin.example.com` is set but the first inbound request has `X-Forwarded-Proto: https` and `X-Forwarded-Host: kalepin.example.com`
- **THEN** the system logs at WARN level: "APP_URL=http://kalepin.example.com but inbound request shows X-Forwarded-Proto=https. OAuth discovery metadata will advertise the wrong issuer; claude.ai connectors will fail. Update APP_URL to https://kalepin.example.com."

#### Scenario: Host mismatch
- **WHEN** `APP_URL=https://kalepin.local` but `X-Forwarded-Host: kalepin.example.com`
- **THEN** the system logs a WARN message naming both values

#### Scenario: Match — no warning
- **WHEN** `APP_URL` matches both `X-Forwarded-Proto` and `X-Forwarded-Host`
- **THEN** no warning is emitted
