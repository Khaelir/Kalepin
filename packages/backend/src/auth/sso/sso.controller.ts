import { Controller, Get, HttpException, HttpStatus, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { SlidingWindowRateLimiter } from '../oauth/rate-limit';
import { buildPostLoginRedirect } from '../return-to';
import { SsoError } from './identity-provider';
import { SsoProviderRegistry } from './sso-providers';
import { SSO_REQUEST_TTL_MS, SsoService } from './sso.service';

export const SSO_COOKIE = 'kp_sso';

/** The `kp_sso` cookie: browser binding only, never sent outside the SSO routes. */
function cookieOptions(req: Request): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/api/auth/sso', secure: req.secure };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || undefined;
  }
  return undefined;
}

function clientIp(req: Request): string {
  return (req.ip ?? req.socket?.remoteAddress ?? 'unknown') as string;
}

@Controller('api/auth')
export class SsoController {
  private readonly startLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 20 });
  private readonly callbackLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 30 });

  constructor(
    private readonly registry: SsoProviderRegistry,
    private readonly sso: SsoService,
  ) {}

  @Get('providers')
  providers() {
    return { providers: this.registry.list() };
  }

  @Get('sso/:provider/start')
  async start(@Param('provider') providerId: string, @Query('returnTo') returnTo: unknown, @Req() req: Request, @Res() res: Response) {
    if (!this.registry.get(providerId)) throw new NotFoundException();
    this.limit(this.startLimiter, req);
    try {
      const { authorizationUrl, binding } = await this.sso.start(providerId, returnTo);
      res.cookie(SSO_COOKIE, binding, { ...cookieOptions(req), maxAge: SSO_REQUEST_TTL_MS });
      res.redirect(302, authorizationUrl.href);
    } catch (err) {
      if (!(err instanceof SsoError)) throw err;
      res.redirect(302, buildPostLoginRedirect(returnTo, { sso_error: err.code }));
    }
  }

  /** Every outcome is a redirect into the SPA, with `token` or `sso_error`. */
  @Get('sso/:provider/callback')
  async callback(@Param('provider') providerId: string, @Req() req: Request, @Res() res: Response) {
    this.limit(this.callbackLimiter, req);
    const query = new URL(req.originalUrl, 'http://kalepin.invalid').searchParams;
    const cookie = readCookie(req.headers.cookie, SSO_COOKIE);
    res.clearCookie(SSO_COOKIE, cookieOptions(req));
    const result = await this.sso.complete(providerId, query, cookie);
    const params: Record<string, string> = result.ok ? { token: result.sessionToken } : { sso_error: result.code };
    res.redirect(302, buildPostLoginRedirect(result.returnTo, params));
  }

  private limit(limiter: SlidingWindowRateLimiter, req: Request): void {
    const check = limiter.check(clientIp(req));
    if (!check.allowed) {
      throw new HttpException({ message: 'Too many requests', retryAfterSec: check.retryAfterSec }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
