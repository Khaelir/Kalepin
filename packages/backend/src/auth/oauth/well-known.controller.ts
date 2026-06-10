import { Controller, Get, Header } from '@nestjs/common';
import { OAUTH_SCOPES } from './oauth-scope';

// Discovery metadata for the MCP authorization flow:
//   - RFC 9728 (Protected Resource Metadata) — tells clients which AS protects /mcp
//   - RFC 8414 (Authorization Server Metadata) — describes the AS endpoints
//
// Both endpoints are public, unauthenticated, and served at the deployment's
// public origin (derived from APP_URL). They MUST stay outside the SPA fallback
// — `app.module.ts` already excludes `/.well-known/{*path}` from ServeStatic.
@Controller('.well-known')
export class WellKnownController {
  private get baseUrl(): string {
    return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  }

  @Get('oauth-protected-resource')
  @Header('Cache-Control', 'public, max-age=3600')
  protectedResource() {
    const base = this.baseUrl;
    return {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: [...OAUTH_SCOPES],
      bearer_methods_supported: ['header'],
      resource_documentation: `${base}/docs/mcp`,
    };
  }

  @Get('oauth-authorization-server')
  @Header('Cache-Control', 'public, max-age=3600')
  authorizationServer() {
    const base = this.baseUrl;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      revocation_endpoint: `${base}/oauth/revoke`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: [...OAUTH_SCOPES],
      service_documentation: `${base}/docs/mcp`,
    };
  }
}
