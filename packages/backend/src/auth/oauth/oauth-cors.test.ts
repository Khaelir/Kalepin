import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  isOAuthCorsPath,
  isOAuthCorsOriginAllowed,
  getOAuthCorsAllowList,
  createOAuthCorsMiddleware,
  DEFAULT_OAUTH_CORS_ORIGIN,
} from './oauth-cors';

describe('isOAuthCorsPath', () => {
  it('matches /mcp and /oauth/* and /.well-known/oauth-*', () => {
    assert.equal(isOAuthCorsPath('/mcp'), true);
    assert.equal(isOAuthCorsPath('/mcp/'), true);
    assert.equal(isOAuthCorsPath('/oauth/token'), true);
    assert.equal(isOAuthCorsPath('/oauth/authorize'), true);
    assert.equal(isOAuthCorsPath('/.well-known/oauth-protected-resource'), true);
    assert.equal(isOAuthCorsPath('/.well-known/oauth-authorization-server'), true);
  });

  it('does not match non-OAuth paths', () => {
    assert.equal(isOAuthCorsPath('/api/auth/api-keys'), false);
    assert.equal(isOAuthCorsPath('/api/files'), false);
    assert.equal(isOAuthCorsPath('/'), false);
    assert.equal(isOAuthCorsPath('/.well-known/security.txt'), false);
  });
});

describe('OAuth CORS allow-list', () => {
  it('always includes claude.ai by default', () => {
    const list = getOAuthCorsAllowList({} as NodeJS.ProcessEnv);
    assert.ok(list.includes(DEFAULT_OAUTH_CORS_ORIGIN));
  });

  it('extends from OAUTH_CORS_ALLOW_LIST env', () => {
    const list = getOAuthCorsAllowList({
      OAUTH_CORS_ALLOW_LIST: 'https://other.example,https://x.test',
    } as NodeJS.ProcessEnv);
    assert.ok(list.includes('https://other.example'));
    assert.ok(list.includes('https://x.test'));
    assert.ok(list.includes(DEFAULT_OAUTH_CORS_ORIGIN));
  });

  it('rejects unknown origins', () => {
    const list = getOAuthCorsAllowList({} as NodeJS.ProcessEnv);
    assert.equal(isOAuthCorsOriginAllowed('https://attacker.example', list), false);
    assert.equal(isOAuthCorsOriginAllowed(undefined, list), false);
  });
});

describe('createOAuthCorsMiddleware', () => {
  function makeReqRes(opts: { method: string; path: string; origin?: string }) {
    const headers: Record<string, string> = {};
    const req: any = {
      method: opts.method,
      path: opts.path,
      headers: opts.origin ? { origin: opts.origin } : {},
    };
    let statusCode = 0;
    let ended = false;
    const res: any = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      status: (c: number) => { statusCode = c; return res; },
      end: () => { ended = true; },
    };
    return { req, res, headers, get statusCode() { return statusCode; }, get ended() { return ended; } };
  }

  it('passes through paths outside the allow-list without setting headers', () => {
    const mw = createOAuthCorsMiddleware(['https://claude.ai']);
    const ctx = makeReqRes({ method: 'GET', path: '/api/files', origin: 'https://claude.ai' });
    let nextCalled = false;
    mw(ctx.req, ctx.res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(ctx.headers['Access-Control-Allow-Origin'], undefined);
  });

  it('sets ACAO for allowed origin on /mcp', () => {
    const mw = createOAuthCorsMiddleware(['https://claude.ai']);
    const ctx = makeReqRes({ method: 'POST', path: '/mcp', origin: 'https://claude.ai' });
    let nextCalled = false;
    mw(ctx.req, ctx.res, () => { nextCalled = true; });
    assert.equal(ctx.headers['Access-Control-Allow-Origin'], 'https://claude.ai');
    assert.equal(ctx.headers['Vary'], 'Origin');
    assert.ok(ctx.headers['Access-Control-Expose-Headers']?.includes('Mcp-Session-Id'));
    assert.equal(nextCalled, true);
  });

  it('omits ACAO for disallowed origin', () => {
    const mw = createOAuthCorsMiddleware(['https://claude.ai']);
    const ctx = makeReqRes({ method: 'POST', path: '/mcp', origin: 'https://attacker.example' });
    mw(ctx.req, ctx.res, () => {});
    assert.equal(ctx.headers['Access-Control-Allow-Origin'], undefined);
  });

  it('preflight OPTIONS short-circuits with 204', () => {
    const mw = createOAuthCorsMiddleware(['https://claude.ai']);
    const ctx = makeReqRes({ method: 'OPTIONS', path: '/mcp', origin: 'https://claude.ai' });
    let nextCalled = false;
    mw(ctx.req, ctx.res, () => { nextCalled = true; });
    assert.equal(ctx.statusCode, 204);
    assert.equal(ctx.ended, true);
    assert.equal(nextCalled, false);
  });
});
