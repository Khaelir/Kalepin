import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Optional, Inject, forwardRef } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth/oauth.service';
import { ACCESS_TOKEN_PREFIX } from './oauth/oauth-tokens';
import { REQUIRED_SCOPE_KEY } from './required-scope.decorator';
import { SCOPE_PERMISSIONS } from './permissions';
import { setRequestUser } from './request-user';
import type { ApiKeyScope, Permission } from './permissions';

@Injectable()
export class CombinedAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
    @Optional() @Inject(forwardRef(() => OAuthService)) private readonly oauthService?: OAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const httpCtx = context.switchToHttp();
    const request = httpCtx.getRequest();
    const response = typeof httpCtx.getResponse === 'function' ? httpCtx.getResponse() : null;
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      this.setMcpChallenge(request, response, /*invalidToken*/ false);
      throw new UnauthorizedException('Missing authorization header');
    }

    const token = authHeader.slice(7);
    const requiredPermission = this.reflector.get<Permission | undefined>(
      REQUIRED_SCOPE_KEY,
      context.getHandler(),
    );

    // OAuth opaque access token (kpoa_at_…) — DB-backed, lifetime-checked.
    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      if (!this.oauthService) {
        this.setMcpChallenge(request, response, true);
        throw new UnauthorizedException('OAuth not configured');
      }
      try {
        const resolved = await this.oauthService.verifyAccessToken(token);
        setRequestUser(request, {
          sub: resolved.sub,
          email: resolved.email,
          scope: resolved.scope,
          grantId: resolved.grantId,
        } as any);
        request.oauthAccessTokenId = resolved.accessTokenId;
        request.originCredential = { type: 'oauth' as const, id: resolved.grantId };
        if (requiredPermission) {
          const allowed = SCOPE_PERMISSIONS[resolved.scope];
          if (!allowed.includes(requiredPermission)) {
            throw new ForbiddenException(`Insufficient scope: requires ${requiredPermission}`);
          }
        }
        return true;
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        this.setMcpChallenge(request, response, true);
        throw err;
      }
    }

    // Existing API key (kp_…) — hashed lookup, scoped.
    if (token.startsWith('kp_')) {
      try {
        const payload = await this.authService.verifyApiKey(token);
        setRequestUser(request, payload);
      } catch (err) {
        this.setMcpChallenge(request, response, true);
        throw err;
      }

      if (requiredPermission) {
        const scope = (request.user.scope ?? 'rw') as ApiKeyScope;
        const allowed = SCOPE_PERMISSIONS[scope];
        if (!allowed.includes(requiredPermission)) {
          throw new ForbiddenException(`Insufficient scope: requires ${requiredPermission}`);
        }
      }

      const apiKeyId = (request.user as { apiKeyId?: number }).apiKeyId;
      if (apiKeyId !== undefined) {
        request.originCredential = { type: 'apikey' as const, id: apiKeyId };
      }
      return true;
    }

    // Fall back to JWT — full access, no scope check
    try {
      const payload = this.authService.verifyToken(token);
      const userId = await this.authService.ensureUser(payload);
      // Resolve sub to the persisted user.id (opaque JWT claim → canonical row).
      setRequestUser(request, { ...payload, sub: userId });
      return true;
    } catch (err) {
      this.setMcpChallenge(request, response, true);
      throw err;
    }
  }

  // Section 10: emit a WWW-Authenticate challenge on unauthenticated /mcp
  // requests so MCP clients (claude.ai, Claude Desktop) discover the
  // authorization server via resource_metadata. RFC 6750 distinguishes
  // missing-credentials (no error param) from invalid_token.
  private setMcpChallenge(request: any, response: any, invalidToken: boolean): void {
    if (!response || typeof response.setHeader !== 'function') return;
    const path: string = request?.path ?? request?.url ?? '';
    if (!path.startsWith('/mcp')) return;
    const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const errorPart = invalidToken ? ', error="invalid_token"' : '';
    response.setHeader(
      'WWW-Authenticate',
      `Bearer realm="kalepin"${errorPart}, resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    );
  }
}
