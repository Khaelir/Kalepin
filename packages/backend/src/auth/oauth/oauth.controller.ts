import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Header,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { OAuthService, OAuthError } from './oauth.service';
import { SlidingWindowRateLimiter } from './rate-limit';
import type { DcrRegistrationRequest } from './oauth.dto';

// Public OAuth endpoints (RFC 7591 / 6749 / 7009).
//
// Mounted under `/oauth`. CORS for these paths is set up in main.ts so
// claude.ai (and operator-configured origins) can reach them from a browser.
@Controller('oauth')
export class OAuthController {
  // 10 reg/min/IP — see tasks 4.3 and 4.4. Distributed botnets defeat this;
  // GC (task 15.4) covers the long-tail accumulation.
  private readonly registerLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 10 });

  // 60/min/client — task 6.8. Keeps a misbehaving client from DoSing the
  // grant lock or saturating the DB.
  private readonly tokenLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 60 });

  constructor(private readonly oauth: OAuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: DcrRegistrationRequest, @Req() req: Request, @Res() res: Response) {
    const ip = this.clientIp(req);
    const limit = this.registerLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({ error: 'rate_limited', error_description: 'Too many registrations' });
      return;
    }

    try {
      const result = await this.oauth.registerClient(body);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OAuthError) {
        res.status(err.httpStatus).json({ error: err.code, error_description: err.description });
        return;
      }
      throw err;
    }
  }

  // GET /oauth/authorize — validates params, persists a request, redirects to
  // /#/oauth/consent?request_id=<id>. The redirect target is the SPA, which
  // pulls request details via the consent API and posts approve/deny.
  @Get('authorize')
  async authorize(@Query() query: Record<string, string>, @Res() res: Response) {
    if (process.env.OAUTH_CONSENT_DISABLED === '1') {
      res.status(503).json({ error: 'consent_disabled' });
      return;
    }
    try {
      const result = await this.oauth.startAuthorization({
        response_type: query.response_type,
        client_id: query.client_id,
        redirect_uri: query.redirect_uri,
        scope: query.scope,
        state: query.state,
        code_challenge: query.code_challenge,
        code_challenge_method: query.code_challenge_method,
      });
      if ('redirectError' in result) {
        const url = new URL(result.redirectError.uri);
        url.searchParams.set('error', result.redirectError.error);
        if (result.redirectError.description) url.searchParams.set('error_description', result.redirectError.description);
        if (result.redirectError.state) url.searchParams.set('state', result.redirectError.state);
        res.redirect(302, url.toString());
        return;
      }
      const target = this.spaConsentUrl(result.requestId);
      res.redirect(302, target);
    } catch (err) {
      if (err instanceof OAuthError) {
        res.status(err.httpStatus).json({ error: err.code, error_description: err.description });
        return;
      }
      throw err;
    }
  }

  @Post('token')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async token(@Body() body: Record<string, string>, @Res() res: Response) {
    const clientId = body.client_id;
    if (clientId) {
      const limit = this.tokenLimiter.check(clientId);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSec));
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
    }

    try {
      switch (body.grant_type) {
        case 'authorization_code': {
          const result = await this.oauth.exchangeAuthorizationCode({
            code: body.code,
            redirect_uri: body.redirect_uri,
            client_id: body.client_id,
            code_verifier: body.code_verifier,
          });
          // grantId is internal — strip before responding.
          const { grantId, ...resp } = result;
          void grantId;
          res.status(200).json(resp);
          return;
        }
        case 'refresh_token': {
          const result = await this.oauth.refreshTokens({
            refresh_token: body.refresh_token,
            client_id: body.client_id,
          });
          const { grantId, usedLeeway, ...resp } = result;
          void grantId;
          void usedLeeway;
          res.status(200).json(resp);
          return;
        }
        default:
          res.status(400).json({ error: 'unsupported_grant_type' });
          return;
      }
    } catch (err) {
      if (err instanceof OAuthError) {
        res.status(err.httpStatus).json({ error: err.code, error_description: err.description });
        return;
      }
      throw err;
    }
  }

  @Post('revoke')
  @HttpCode(200)
  async revoke(@Body() body: Record<string, string>) {
    // RFC 7009: always 200, never leak token validity.
    try {
      await this.oauth.revokeToken(body.token, body.token_type_hint);
    } catch {
      // Swallow — RFC 7009 forbids leaking token validity via response codes.
    }
    return {};
  }

  private spaConsentUrl(requestId: string): string {
    const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return `${base}/#/oauth/consent?request_id=${encodeURIComponent(requestId)}`;
  }

  private clientIp(req: Request): string {
    // Trust-proxy is enabled in main.ts, so req.ip is the original client when
    // X-Forwarded-For is set by the proxy.
    return (req.ip || req.socket.remoteAddress || 'unknown').toString();
  }
}
