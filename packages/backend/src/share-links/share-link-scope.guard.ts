import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ScopedTokenService } from './scoped-token.service';

const SHARELINK_SCHEME = 'ShareLink ';

/**
 * Guard for anonymous share-link content access.
 *
 * Requires an `Authorization: ShareLink <token>` header. The token is an HMAC
 * over `(code, path, exp)`; on success, attaches the verified `(code, path)`
 * tuple to the request as `req.shareLinkContext`. Critically, **req.user is
 * never set** — the token authorizes a single resource, not an identity.
 *
 * The request's URL `:code` parameter must match the token's code so a guest
 * cannot replay a token issued for a different share link.
 */
@Injectable()
export class ShareLinkScopeGuard implements CanActivate {
  constructor(private readonly tokens: ScopedTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith(SHARELINK_SCHEME)) {
      throw new UnauthorizedException('Missing or malformed ShareLink credential');
    }
    const token = header.slice(SHARELINK_SCHEME.length).trim();
    const verified = this.tokens.verifyAccessToken(token);
    if (!verified) {
      throw new UnauthorizedException('Invalid or expired ShareLink credential');
    }
    const codeParam: string | undefined = req.params?.code;
    if (codeParam && codeParam !== verified.code) {
      throw new UnauthorizedException('ShareLink credential does not match URL');
    }
    req.shareLinkContext = verified;
    return true;
  }
}
