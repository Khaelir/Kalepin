// A stand-in for Microsoft Entra ID's v2.0 endpoints, so the SSO flow runs
// end-to-end without contacting Microsoft. It serves discovery, JWKS, an
// /authorize that redirects straight back with a code for the identity a test
// picked, and a /token that checks PKCE and returns an RS256 ID token.
//
// Tests pick the identity with `setMockIdentity()` (POST /__set-identity); it
// stays in effect until the next call. `lastMockAuthorize()` returns the most
// recent authorize parameters and `lastMockTokens()` the tokens last issued.

import http from 'http';
import { createHash, generateKeyPairSync, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

export const MOCK_OIDC_PORT = 3199;
export const MOCK_OIDC_TENANT = '6e2e0000-0000-4000-8000-00000000e2e0';
export const MOCK_OIDC_CLIENT_ID = '6e2e0000-0000-4000-8000-0000000c11e7';
export const MOCK_OIDC_CLIENT_SECRET = 'e2e-sso-client-secret';
export const MOCK_OIDC_BASE = `http://localhost:${MOCK_OIDC_PORT}`;

export interface MockIdentity {
  email?: string;
  preferred_username?: string;
  oid?: string;
  /** Defaults to the configured tenant. */
  tid?: string;
  name?: string;
  /** Redirect back with this OAuth error (e.g. `access_denied`) instead of a code. */
  error?: string;
}

interface PendingCode {
  identity: MockIdentity;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface MockIssuerOptions {
  /** The only redirect URI /authorize accepts, like an Entra app registration. */
  redirectUri: string;
  port?: number;
}

export async function startMockOidcIssuer(opts: MockIssuerOptions): Promise<{ close: () => Promise<void> }> {
  const port = opts.port ?? MOCK_OIDC_PORT;
  const base = `http://localhost:${port}`;
  const tenantPath = `/${MOCK_OIDC_TENANT}`;
  const issuer = `${base}${tenantPath}/v2.0`;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const codes = new Map<string, PendingCode>();
  let identity: MockIdentity = { email: 'sso-user@example.com', oid: 'oid-default', name: 'SSO User' };
  let lastAuthorize: Record<string, string> = {};
  let lastTokens: { id_token?: string; access_token?: string } = {};

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: http.IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
    });
  const redirect = (res: http.ServerResponse, target: string, params: Record<string, string>) => {
    const url = new URL(target);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    res.writeHead(302, { location: url.href });
    res.end();
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    const path = url.pathname;

    if (path === '/__set-identity' && req.method === 'POST') {
      identity = JSON.parse((await readBody(req)) || '{}');
      return json(res, 200, { ok: true });
    }
    if (path === '/__last-authorize') return json(res, 200, lastAuthorize);
    if (path === '/__last-tokens') return json(res, 200, lastTokens);

    if (path === `${tenantPath}/v2.0/.well-known/openid-configuration`) {
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${base}${tenantPath}/oauth2/v2.0/authorize`,
        token_endpoint: `${base}${tenantPath}/oauth2/v2.0/token`,
        jwks_uri: `${base}${tenantPath}/discovery/v2.0/keys`,
        response_types_supported: ['code', 'id_token', 'code id_token'],
        response_modes_supported: ['query', 'fragment', 'form_post'],
        subject_types_supported: ['pairwise'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'private_key_jwt', 'client_secret_basic'],
        claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'name', 'preferred_username', 'email', 'oid', 'tid'],
      });
    }

    if (path === `${tenantPath}/discovery/v2.0/keys`) {
      const jwk = keys.publicKey.export({ format: 'jwk' });
      return json(res, 200, { keys: [{ ...jwk, kid: 'mock-key-1', use: 'sig', alg: 'RS256' }] });
    }

    if (path === `${tenantPath}/oauth2/v2.0/authorize`) {
      const q = Object.fromEntries(url.searchParams);
      lastAuthorize = q;
      // Like Entra's AADSTS50011 / AADSTS700016: bad requests never reach the app.
      if (q.client_id !== MOCK_OIDC_CLIENT_ID) return json(res, 400, { error: 'AADSTS700016: unknown client' });
      if (q.redirect_uri !== opts.redirectUri) return json(res, 400, { error: 'AADSTS50011: redirect URI mismatch' });
      if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge || !q.state || !q.nonce) {
        return json(res, 400, { error: 'invalid_request' });
      }
      if (identity.error) {
        return redirect(res, q.redirect_uri, { error: identity.error, error_description: `AADSTS65004: ${identity.error}`, state: q.state });
      }
      const code = randomBytes(24).toString('base64url');
      codes.set(code, { identity, nonce: q.nonce, codeChallenge: q.code_challenge, redirectUri: q.redirect_uri });
      return redirect(res, q.redirect_uri, { code, state: q.state });
    }

    if (path === `${tenantPath}/oauth2/v2.0/token` && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      if (form.get('client_id') !== MOCK_OIDC_CLIENT_ID || form.get('client_secret') !== MOCK_OIDC_CLIENT_SECRET) {
        return json(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
      }
      const code = form.get('code') ?? '';
      const pending = codes.get(code);
      codes.delete(code);
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (
        form.get('grant_type') !== 'authorization_code' ||
        !pending ||
        pending.codeChallenge !== challenge ||
        pending.redirectUri !== form.get('redirect_uri')
      ) {
        return json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS70008: invalid or reused code' });
      }
      const { identity: who } = pending;
      const claims: Record<string, unknown> = {
        sub: `pairwise-${who.oid ?? 'none'}`,
        tid: who.tid ?? MOCK_OIDC_TENANT,
        nonce: pending.nonce,
        ver: '2.0',
      };
      for (const key of ['email', 'preferred_username', 'oid', 'name'] as const) {
        if (who[key] !== undefined) claims[key] = who[key];
      }
      const idToken = jwt.sign(claims, privatePem, {
        algorithm: 'RS256',
        keyid: 'mock-key-1',
        issuer,
        audience: MOCK_OIDC_CLIENT_ID,
        expiresIn: 300,
      });
      const accessToken = `mock-access-${randomBytes(16).toString('hex')}`;
      lastTokens = { id_token: idToken, access_token: accessToken };
      return json(res, 200, { token_type: 'Bearer', scope: 'openid email profile', expires_in: 300, access_token: accessToken, id_token: idToken });
    }

    json(res, 404, { error: 'not_found', path });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function setMockIdentity(identity: MockIdentity): Promise<void> {
  const res = await fetch(`${MOCK_OIDC_BASE}/__set-identity`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(identity),
  });
  if (!res.ok) throw new Error(`mock issuer: set identity failed (${res.status})`);
}

export async function lastMockAuthorize(): Promise<Record<string, string>> {
  return (await fetch(`${MOCK_OIDC_BASE}/__last-authorize`)).json();
}

export async function lastMockTokens(): Promise<{ id_token?: string; access_token?: string }> {
  return (await fetch(`${MOCK_OIDC_BASE}/__last-tokens`)).json();
}
