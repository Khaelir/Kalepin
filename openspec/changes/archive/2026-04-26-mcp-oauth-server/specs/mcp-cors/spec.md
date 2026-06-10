## ADDED Requirements

### Requirement: CORS allow-list scoped to OAuth and MCP surfaces

The system SHALL apply CORS middleware only to the paths `/mcp`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, and `/oauth/*`. Other API paths SHALL retain the default same-origin behaviour. The allow-list SHALL include `https://claude.ai` and SHALL be extensible via the `OAUTH_CORS_ALLOW_LIST` environment variable (comma-separated origins).

#### Scenario: claude.ai origin allowed on /mcp
- **WHEN** a request to `POST /mcp` arrives with `Origin: https://claude.ai`
- **THEN** the response includes `Access-Control-Allow-Origin: https://claude.ai` and `Access-Control-Allow-Credentials: false`

#### Scenario: Disallowed origin
- **WHEN** a request to `POST /mcp` arrives with `Origin: https://attacker.example.com` (not on the allow-list)
- **THEN** the response omits `Access-Control-Allow-Origin` (the browser will block the response client-side)

#### Scenario: API paths unchanged
- **WHEN** a request to `POST /api/files` arrives with `Origin: https://claude.ai`
- **THEN** the response does NOT include `Access-Control-Allow-Origin` (CORS middleware does not apply outside the OAuth/MCP scope)

#### Scenario: Self-hosted operator adds origin
- **WHEN** the operator sets `OAUTH_CORS_ALLOW_LIST=https://my-mcp-client.example.com` and restarts the server
- **THEN** requests to `/mcp` from `https://my-mcp-client.example.com` receive the appropriate `Access-Control-Allow-Origin` header

### Requirement: Preflight requests handled for /mcp

The system SHALL respond to `OPTIONS` preflight requests on `/mcp` with the appropriate `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` headers covering the methods and headers MCP clients use.

#### Scenario: Preflight for POST /mcp
- **WHEN** the browser sends `OPTIONS /mcp` with `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: authorization, content-type, mcp-session-id`
- **THEN** the response is 204 No Content with `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS` and `Access-Control-Allow-Headers: authorization, content-type, mcp-session-id, mcp-protocol-version`

#### Scenario: Preflight max-age
- **WHEN** a preflight succeeds
- **THEN** the response includes `Access-Control-Max-Age: 600` to reduce preflight churn

### Requirement: Mcp-Session-Id exposed to browser clients

The system SHALL include `Mcp-Session-Id` in `Access-Control-Expose-Headers` on `/mcp` responses so that browser-based MCP clients can read the session header set by `StreamableHTTPServerTransport` on initialize.

#### Scenario: Initialize response readable
- **WHEN** a browser client sends an initialize JSON-RPC message to `POST /mcp` from an allow-listed origin
- **THEN** the response carries `Access-Control-Expose-Headers: Mcp-Session-Id` so the client's JavaScript can read `response.headers.get('mcp-session-id')` and reuse it on subsequent requests

### Requirement: CORS does not weaken authentication

The CORS allow-list SHALL NOT bypass authentication. Cross-origin requests still require a valid bearer token; CORS only controls whether the browser hands the response back to the calling JavaScript.

#### Scenario: Allowed origin without token
- **WHEN** a request to `POST /mcp` arrives from an allow-listed origin with no Authorization header
- **THEN** the response is 401 Unauthorized (the CORS headers are present so the browser can read the 401, but authentication still fails)
