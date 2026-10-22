import 'reflect-metadata';
import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException, ForbiddenException, ExecutionContext } from '@nestjs/common';
import { CombinedAuthGuard } from './combined-auth.guard';
import { ACCESS_TOKEN_PREFIX } from './oauth/oauth-tokens';
import { REQUIRED_SCOPE_KEY } from './required-scope.decorator';

interface FakeRequest {
  headers: Record<string, string | undefined>;
  path?: string;
  user?: unknown;
  oauthAccessTokenId?: number;
  originCredential?: unknown;
}

interface FakeResponse {
  headers: Record<string, string>;
  setHeader: (k: string, v: string) => void;
}

function makeContext(req: FakeRequest, res?: FakeResponse, requiredScope?: string): ExecutionContext {
  const handler = () => undefined;
  if (requiredScope) Reflect.defineMetadata(REQUIRED_SCOPE_KEY, requiredScope, handler);
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => null as never,
    }),
    getHandler: () => handler,
    getClass: () => class C {},
  } as unknown as ExecutionContext;
}

function makeRes(): FakeResponse {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(k: string, v: string) { headers[k] = v; },
  };
}

const reflector = new Reflector();
const authServiceStub: any = {
  verifyApiKey: async (token: string) => ({ sub: 1, email: 'a@x.com', scope: 'rw', apiKeyId: 42, isApiKey: true }),
  verifyToken: (token: string) => {
    if (token === 'goodjwt') return { sub: 7, email: 'jwt@x.com' };
    throw new Error('bad jwt');
  },
  // ensureUser now returns the persisted user.id (mirrors the real service).
  ensureUser: async (payload: { sub: number; email: string }) => payload.sub,
};

describe('CombinedAuthGuard token-shape resolution', () => {
  let oauthStub: any;
  beforeEach(() => {
    oauthStub = {
      verifyAccessToken: async (token: string) => {
        if (token === `${ACCESS_TOKEN_PREFIX}good`) {
          return {
            sub: 99,
            email: 'oauth@x.com',
            scope: 'rw',
            grantId: 11,
            accessTokenId: 22,
            oauthScopes: ['notes.read', 'notes.write'],
          };
        }
        throw new UnauthorizedException('Invalid access token');
      },
    };
  });

  it('routes kpoa_at_ to OAuth verification and sets request.user', async () => {
    const guard = new CombinedAuthGuard(authServiceStub, reflector, oauthStub);
    const req: FakeRequest = { headers: { authorization: `Bearer ${ACCESS_TOKEN_PREFIX}good` } };
    const ok = await guard.canActivate(makeContext(req));
    assert.equal(ok, true);
    assert.deepEqual(req.user, { sub: 99, email: 'oauth@x.com', scope: 'rw', grantId: 11 });
    assert.equal(req.oauthAccessTokenId, 22);
    assert.deepEqual(req.originCredential, { type: 'oauth', id: 11 });
  });

  it('routes kp_ to API-key verification', async () => {
    const guard = new CombinedAuthGuard(authServiceStub, reflector, oauthStub);
    const req: FakeRequest = { headers: { authorization: 'Bearer kp_secret' } };
    const ok = await guard.canActivate(makeContext(req));
    assert.equal(ok, true);
    assert.deepEqual(req.originCredential, { type: 'apikey', id: 42 });
  });

  it('falls back to JWT verification', async () => {
    const guard = new CombinedAuthGuard(authServiceStub, reflector, oauthStub);
    const req: FakeRequest = { headers: { authorization: 'Bearer goodjwt' } };
    const ok = await guard.canActivate(makeContext(req));
    assert.equal(ok, true);
    assert.deepEqual(req.user, { sub: 7, email: 'jwt@x.com' });
  });

  it('OAuth verification never returns admin scope', async () => {
    const guard = new CombinedAuthGuard(authServiceStub, reflector, oauthStub);
    const req: FakeRequest = { headers: { authorization: `Bearer ${ACCESS_TOKEN_PREFIX}good` } };
    await guard.canActivate(makeContext(req));
    assert.notEqual((req.user as { scope: string }).scope, 'admin');
  });

  it('emits WWW-Authenticate with error="invalid_token" on /mcp 401', async () => {
    const guard = new CombinedAuthGuard(authServiceStub, reflector, oauthStub);
    const req: FakeRequest = {
      headers: { authorization: `Bearer ${ACCESS_TOKEN_PREFIX}bogus` },
      path: '/mcp',
    };
    const res = makeRes();
    await assert.rejects(guard.canActivate(makeContext(req, res)));
    const header = res.headers['WWW-Authenticate'];
    assert.ok(header, 'should set WWW-Authenticate');
    assert.match(header, /Bearer realm="kalepin"/);
    assert.match(header, /error="invalid_token"/);
    assert.match(header, /resource_metadata=/);
  });

  it('omits error= when no credentials are presented', async () => {
    const guard = new CombinedAuthGuard(authServiceStub, reflector, oauthStub);
    const req: FakeRequest = { headers: {}, path: '/mcp' };
    const res = makeRes();
    await assert.rejects(guard.canActivate(makeContext(req, res)));
    const header = res.headers['WWW-Authenticate'];
    assert.ok(header);
    assert.doesNotMatch(header, /error=/);
  });
});

describe('CombinedAuthGuard JWT session scope', () => {
  const previousAdmins = process.env.ADMIN_EMAILS;
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
  });
  after(() => {
    if (previousAdmins === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previousAdmins;
  });

  const sessionStub: any = {
    ...authServiceStub,
    verifyToken: (token: string) => {
      if (token === 'userjwt') return { sub: 7, email: 'jwt@x.com' };
      if (token === 'adminjwt') return { sub: 8, email: 'Boss@x.com' };
      throw new Error('bad jwt');
    },
  };

  it('rejects a non-admin session on admin:* routes', async () => {
    const guard = new CombinedAuthGuard(sessionStub, reflector);
    for (const scope of ['admin:backup', 'admin:stats']) {
      const req: FakeRequest = { headers: { authorization: 'Bearer userjwt' } };
      await assert.rejects(guard.canActivate(makeContext(req, undefined, scope)), ForbiddenException);
    }
  });

  it('allows an ADMIN_EMAILS session on admin:* routes', async () => {
    const guard = new CombinedAuthGuard(sessionStub, reflector);
    const req: FakeRequest = { headers: { authorization: 'Bearer adminjwt' } };
    assert.equal(await guard.canActivate(makeContext(req, undefined, 'admin:backup')), true);
  });

  it('allows a non-admin session on rw routes and keeps request.user scope-less', async () => {
    const guard = new CombinedAuthGuard(sessionStub, reflector);
    const req: FakeRequest = { headers: { authorization: 'Bearer userjwt' } };
    assert.equal(await guard.canActivate(makeContext(req, undefined, 'notes:delete')), true);
    assert.deepEqual(req.user, { sub: 7, email: 'jwt@x.com' });
  });
});
