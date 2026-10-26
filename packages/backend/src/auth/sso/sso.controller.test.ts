import 'reflect-metadata';
import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SsoController, readCookie } from './sso.controller';
import { SSO_CONFIG, SsoProviderRegistry } from './sso-providers';
import { SsoService, SsoCompletion } from './sso.service';
import { SsoConfig, parseSsoConfig } from './sso-config';
import { SsoError } from './identity-provider';

const FULL_ENV = {
  APP_URL: 'https://kalepin.example.com',
  SSO_MICROSOFT_TENANT_ID: '1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901',
  SSO_MICROSOFT_CLIENT_ID: '9f8e7d6c-5b4a-3928-1706-f5e4d3c2b1a0',
  SSO_MICROSOFT_CLIENT_SECRET: 'secret',
};

class FakeSsoService {
  startError?: SsoError;
  completion: SsoCompletion = { ok: true, returnTo: '/#/oauth/consent?request_id=abc', sessionToken: 'JWT', userId: 1 };
  completed: { providerId: string; query: string; cookie: string | undefined }[] = [];

  async start(_providerId: string, _returnTo: unknown) {
    if (this.startError) throw this.startError;
    return { authorizationUrl: new URL('https://login.example/authorize?state=s'), binding: 'the-binding' };
  }

  async complete(providerId: string, query: URLSearchParams, cookie: string | undefined) {
    this.completed.push({ providerId, query: query.toString(), cookie });
    return this.completion;
  }
}

let app: INestApplication | undefined;

async function serve(config: SsoConfig, sso = new FakeSsoService()) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SsoController],
    providers: [{ provide: SSO_CONFIG, useValue: config }, SsoProviderRegistry, { provide: SsoService, useValue: sso }],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { base, sso };
}

function get(url: string, headers: Record<string, string> = {}) {
  return fetch(url, { redirect: 'manual', headers });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/auth/providers', () => {
  it('returns no providers without configuration', async () => {
    const { base } = await serve(parseSsoConfig({}));
    const res = await get(`${base}/api/auth/providers`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { providers: [] });
  });

  it('returns Microsoft with a full configuration', async () => {
    const { base } = await serve(parseSsoConfig(FULL_ENV));
    const res = await get(`${base}/api/auth/providers`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { providers: [{ id: 'microsoft', label: 'Microsoft' }] });
  });
});

describe('GET /api/auth/sso/:provider/start', () => {
  it('is 404 for a disabled or unknown provider', async () => {
    const { base } = await serve(parseSsoConfig({}));
    assert.equal((await get(`${base}/api/auth/sso/microsoft/start`)).status, 404);
    assert.equal((await get(`${base}/api/auth/sso/unknown/start`)).status, 404);
  });

  it('redirects to the provider and sets the binding cookie', async () => {
    const { base } = await serve(parseSsoConfig(FULL_ENV));
    const res = await get(`${base}/api/auth/sso/microsoft/start?returnTo=/doc/Notes.md`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://login.example/authorize?state=s');
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^kp_sso=the-binding; /);
    assert.match(cookie, /Max-Age=600/);
    assert.match(cookie, /Path=\/api\/auth\/sso/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/);
  });

  it('marks the cookie Secure behind an HTTPS proxy', async () => {
    const { base } = await serve(parseSsoConfig(FULL_ENV));
    (app!.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', true);
    const res = await get(`${base}/api/auth/sso/microsoft/start`, { 'x-forwarded-proto': 'https' });
    assert.match(res.headers.get('set-cookie') ?? '', /Secure/);
  });

  it('returns to the SPA with sso_error when the provider is unavailable', async () => {
    const sso = new FakeSsoService();
    sso.startError = new SsoError('unavailable');
    const { base } = await serve(parseSsoConfig(FULL_ENV), sso);
    const returnTo = encodeURIComponent('/#/oauth/consent?request_id=abc');
    const res = await get(`${base}/api/auth/sso/microsoft/start?returnTo=${returnTo}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?sso_error=unavailable#/oauth/consent?request_id=abc');
    assert.equal(res.headers.get('set-cookie'), null);
  });

  it('rate limits a single IP to 20 starts a minute', async () => {
    const { base } = await serve(parseSsoConfig(FULL_ENV));
    for (let i = 0; i < 20; i++) assert.equal((await get(`${base}/api/auth/sso/microsoft/start`)).status, 302);
    assert.equal((await get(`${base}/api/auth/sso/microsoft/start`)).status, 429);
  });
});

describe('GET /api/auth/sso/:provider/callback', () => {
  it('passes the query and cookie on, clears the cookie and redirects with the token', async () => {
    const { base, sso } = await serve(parseSsoConfig(FULL_ENV));
    const res = await get(`${base}/api/auth/sso/microsoft/callback?code=c&state=s`, { cookie: 'other=1; kp_sso=the-binding' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?token=JWT#/oauth/consent?request_id=abc');
    assert.deepEqual(sso.completed, [{ providerId: 'microsoft', query: 'code=c&state=s', cookie: 'the-binding' }]);
    const cleared = res.headers.get('set-cookie') ?? '';
    assert.match(cleared, /^kp_sso=; /);
    assert.match(cleared, /Path=\/api\/auth\/sso/);
    assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
  });

  it('redirects with sso_error on failure', async () => {
    const sso = new FakeSsoService();
    sso.completion = { ok: false, returnTo: '/', code: 'expired' };
    const { base } = await serve(parseSsoConfig(FULL_ENV), sso);
    const res = await get(`${base}/api/auth/sso/microsoft/callback?state=s`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?sso_error=expired');
    assert.equal(sso.completed[0].cookie, undefined);
  });

  it('rate limits a single IP to 30 callbacks a minute', async () => {
    const { base } = await serve(parseSsoConfig(FULL_ENV));
    for (let i = 0; i < 30; i++) assert.equal((await get(`${base}/api/auth/sso/microsoft/callback`)).status, 302);
    assert.equal((await get(`${base}/api/auth/sso/microsoft/callback`)).status, 429);
  });
});

describe('readCookie', () => {
  it('finds a cookie by exact name', () => {
    assert.equal(readCookie('a=1; kp_sso=v; b=2', 'kp_sso'), 'v');
    assert.equal(readCookie('xkp_sso=v', 'kp_sso'), undefined);
    assert.equal(readCookie('kp_sso=', 'kp_sso'), undefined);
    assert.equal(readCookie(undefined, 'kp_sso'), undefined);
  });
});
