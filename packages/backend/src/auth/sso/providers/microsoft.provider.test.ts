import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import * as oidc from 'openid-client';
import { MicrosoftProvider } from './microsoft.provider';
import { SsoError } from '../identity-provider';

const TENANT = '1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901';
const CLIENT = '9f8e7d6c-5b4a-3928-1706-f5e4d3c2b1a0';
const SECRET = 'the-secret';
const REDIRECT = 'https://kalepin.example.com/api/auth/sso/microsoft/callback';

interface PendingCode {
  codeChallenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
}

/** A minimal Entra-shaped issuer: discovery, JWKS and the token endpoint. */
class TestIssuer {
  private server = http.createServer((req, res) => this.handle(req, res));
  private keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private codes = new Map<string, PendingCode>();
  base = '';
  discoveryFailures = 0;
  discoveryHits = 0;
  tokenError?: { status: number; body: Record<string, unknown> };

  get issuer() {
    return `${this.base}/${TENANT}/v2.0`;
  }

  async start() {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  issueCode(p: { codeChallenge: string; redirectUri: string; claims: Record<string, unknown> }): string {
    const code = randomBytes(16).toString('hex');
    this.codes.set(code, p);
    return code;
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url!, this.base);
    if (url.pathname === `/${TENANT}/v2.0/.well-known/openid-configuration`) {
      this.discoveryHits++;
      if (this.discoveryFailures > 0) {
        this.discoveryFailures--;
        return this.json(res, 503, { error: 'unavailable' });
      }
      return this.json(res, 200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.base}/${TENANT}/oauth2/v2.0/authorize`,
        token_endpoint: `${this.base}/${TENANT}/oauth2/v2.0/token`,
        jwks_uri: `${this.base}/${TENANT}/discovery/v2.0/keys`,
        response_types_supported: ['code'],
        subject_types_supported: ['pairwise'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      });
    }
    if (url.pathname === `/${TENANT}/discovery/v2.0/keys`) {
      const jwk = this.keys.publicKey.export({ format: 'jwk' });
      return this.json(res, 200, { keys: [{ ...jwk, kid: 'k1', use: 'sig', alg: 'RS256' }] });
    }
    if (url.pathname === `/${TENANT}/oauth2/v2.0/token` && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        if (this.tokenError) return this.json(res, this.tokenError.status, this.tokenError.body);
        if (form.get('client_id') !== CLIENT || form.get('client_secret') !== SECRET) {
          return this.json(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
        }
        const pending = this.codes.get(form.get('code') ?? '');
        this.codes.delete(form.get('code') ?? '');
        const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (!pending || pending.codeChallenge !== challenge || pending.redirectUri !== form.get('redirect_uri')) {
          return this.json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS70008: bad code' });
        }
        const idToken = jwt.sign(
          { sub: 'pairwise-sub', aud: CLIENT, iss: this.issuer, ...pending.claims },
          this.keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
          // A test that sets `exp` itself can't also pass expiresIn.
          'exp' in pending.claims ? { algorithm: 'RS256', keyid: 'k1' } : { algorithm: 'RS256', keyid: 'k1', expiresIn: 300 },
        );
        this.json(res, 200, { access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken });
      });
      return;
    }
    this.json(res, 404, { error: 'not_found' });
  }
}

const issuer = new TestIssuer();

function provider(authorityHost = issuer.base) {
  return new MicrosoftProvider({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET, authorityHost, redirectUri: REDIRECT });
}

async function startFlow(p: MicrosoftProvider) {
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const url = await p.authorizationUrl({ state, nonce, codeChallenge });
  return { state, nonce, codeVerifier, codeChallenge, url };
}

function claims(nonce: string, extra: Record<string, unknown> = {}) {
  return { nonce, tid: TENANT, oid: 'oid-1', email: 'alice@company.com', preferred_username: 'alice@company.com', name: 'Alice', ...extra };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof SsoError && err.code === code);
}

describe('MicrosoftProvider', () => {
  before(() => issuer.start());
  after(() => issuer.stop());
  beforeEach(() => {
    issuer.discoveryFailures = 0;
    issuer.discoveryHits = 0;
    issuer.tokenError = undefined;
  });

  it('builds the authorization request', async () => {
    const { url, state, nonce, codeChallenge } = await startFlow(provider());
    assert.equal(url.origin + url.pathname, `${issuer.base}/${TENANT}/oauth2/v2.0/authorize`);
    const q = url.searchParams;
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('client_id'), CLIENT);
    assert.equal(q.get('redirect_uri'), REDIRECT);
    assert.equal(q.get('scope'), 'openid email profile');
    assert.equal(q.get('code_challenge'), codeChallenge);
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.equal(q.get('state'), state);
    assert.equal(q.get('nonce'), nonce);
    assert.equal(q.get('prompt'), 'select_account');
  });

  it('exchanges the code for a validated identity', async () => {
    const p = provider();
    const flow = await startFlow(p);
    const code = issuer.issueCode({ codeChallenge: flow.codeChallenge, redirectUri: REDIRECT, claims: claims(flow.nonce) });
    const identity = await p.exchange({ query: new URLSearchParams({ code, state: flow.state }), ...flow });
    assert.deepEqual(identity, {
      issuer: issuer.issuer,
      subject: 'oid-1',
      emails: ['alice@company.com', 'alice@company.com'],
      displayName: 'Alice',
    });
  });

  it('caches discovery', async () => {
    const p = provider();
    await startFlow(p);
    await startFlow(p);
    assert.equal(issuer.discoveryHits, 1);
  });

  it('reports unavailable when discovery fails, and retries on the next use', async () => {
    const p = provider();
    issuer.discoveryFailures = 1;
    await rejectsWith(startFlow(p), 'unavailable');
    await startFlow(p);
    assert.equal(issuer.discoveryHits, 2);
  });

  it('reports unavailable when the authority is unreachable', async () => {
    await rejectsWith(startFlow(provider('http://127.0.0.1:9')), 'unavailable');
  });

  it('maps access_denied to cancelled', async () => {
    const p = provider();
    const flow = await startFlow(p);
    const query = new URLSearchParams({ error: 'access_denied', error_description: 'AADSTS65004: declined', state: flow.state });
    await rejectsWith(p.exchange({ query, ...flow }), 'cancelled');
  });

  it('maps other authorization errors to provider_error', async () => {
    const p = provider();
    const flow = await startFlow(p);
    const query = new URLSearchParams({ error: 'invalid_request', error_description: 'AADSTS50011: redirect', state: flow.state });
    await rejectsWith(p.exchange({ query, ...flow }), 'provider_error');
  });

  it('maps a rejected code exchange to provider_error', async () => {
    const p = provider();
    const flow = await startFlow(p);
    const code = issuer.issueCode({ codeChallenge: flow.codeChallenge, redirectUri: REDIRECT, claims: claims(flow.nonce) });
    issuer.tokenError = { status: 401, body: { error: 'invalid_client', error_description: 'AADSTS7000222: expired secret' } };
    await rejectsWith(p.exchange({ query: new URLSearchParams({ code, state: flow.state }), ...flow }), 'provider_error');
  });

  it('rejects a wrong PKCE verifier', async () => {
    const p = provider();
    const flow = await startFlow(p);
    const code = issuer.issueCode({ codeChallenge: flow.codeChallenge, redirectUri: REDIRECT, claims: claims(flow.nonce) });
    const query = new URLSearchParams({ code, state: flow.state });
    await rejectsWith(p.exchange({ query, ...flow, codeVerifier: oidc.randomPKCECodeVerifier() }), 'provider_error');
  });

  it('rejects an ID token with the wrong nonce, audience or issuer', async () => {
    for (const extra of [{ nonce: 'other' }, { aud: 'someone-else' }, { iss: 'https://evil.example/v2.0' }]) {
      const p = provider();
      const flow = await startFlow(p);
      const code = issuer.issueCode({ codeChallenge: flow.codeChallenge, redirectUri: REDIRECT, claims: claims(flow.nonce, extra) });
      await rejectsWith(p.exchange({ query: new URLSearchParams({ code, state: flow.state }), ...flow }), 'provider_error');
    }
  });

  it('rejects an expired ID token', async () => {
    const p = provider();
    const flow = await startFlow(p);
    const past = Math.floor(Date.now() / 1000) - 3600;
    const code = issuer.issueCode({
      codeChallenge: flow.codeChallenge,
      redirectUri: REDIRECT,
      claims: claims(flow.nonce, { iat: past - 300, exp: past }),
    });
    await rejectsWith(p.exchange({ query: new URLSearchParams({ code, state: flow.state }), ...flow }), 'provider_error');
  });

  it('rejects a token from another tenant', async () => {
    const p = provider();
    const flow = await startFlow(p);
    const code = issuer.issueCode({
      codeChallenge: flow.codeChallenge,
      redirectUri: REDIRECT,
      claims: claims(flow.nonce, { tid: '99999999-0000-0000-0000-000000000000' }),
    });
    await rejectsWith(p.exchange({ query: new URLSearchParams({ code, state: flow.state }), ...flow }), 'wrong_tenant');
  });
});
