import { test, expect, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { BACKEND_PORT } from '../playwright.config';

const BACKEND = `http://localhost:${BACKEND_PORT}`;
const JWT_SECRET = 'test-secret';

let userIdCounter = 1000;
function makeJwt(email: string): { token: string; sub: number; email: string } {
  const sub = ++userIdCounter;
  const token = jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: '1h' });
  return { token, sub, email };
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: s256(verifier) };
}

async function registerClient(req: APIRequestContext, redirectUri = 'https://example.com/cb') {
  const res = await req.post(`${BACKEND}/oauth/register`, {
    data: {
      client_name: 'E2E test client',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect(res.status()).toBe(201);
  return await res.json();
}

async function startAuthorize(req: APIRequestContext, opts: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  state?: string;
}): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scope,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    ...(opts.state ? { state: opts.state } : {}),
  });
  const res = await req.get(`${BACKEND}/oauth/authorize?${params}`, { maxRedirects: 0 });
  expect([302, 303]).toContain(res.status());
  const location = res.headers()['location'];
  expect(location).toBeTruthy();
  const url = new URL(location);
  const requestId = url.hash.split('?').slice(1).join('?');
  const requestParams = new URLSearchParams(requestId);
  const id = requestParams.get('request_id');
  expect(id).toBeTruthy();
  return id!;
}

async function approve(req: APIRequestContext, jwtToken: string, requestId: string, grantedScope?: string[]): Promise<string> {
  const res = await req.post(`${BACKEND}/api/oauth/authorize/${requestId}/approve`, {
    headers: { Authorization: `Bearer ${jwtToken}` },
    data: grantedScope ? { granted_scope: grantedScope } : {},
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  const url = new URL(body.redirect_to);
  const code = url.searchParams.get('code');
  expect(code).toBeTruthy();
  return code!;
}

async function exchangeCode(req: APIRequestContext, opts: {
  code: string;
  redirectUri: string;
  clientId: string;
  verifier: string;
}) {
  const res = await req.post(`${BACKEND}/oauth/token`, {
    form: {
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      code_verifier: opts.verifier,
    },
  });
  expect(res.status()).toBe(200);
  return await res.json();
}

test.describe('OAuth — discovery metadata (3.4)', () => {
  test('serves protected-resource metadata', async ({ request }) => {
    const res = await request.get(`${BACKEND}/.well-known/oauth-protected-resource`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.resource).toMatch(/\/mcp$/);
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.scopes_supported).toEqual(expect.arrayContaining(['notes.read', 'notes.write']));
  });

  test('serves authorization-server metadata', async ({ request }) => {
    const res = await request.get(`${BACKEND}/.well-known/oauth-authorization-server`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBeTruthy();
    expect(body.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
    expect(body.token_endpoint).toMatch(/\/oauth\/token$/);
    expect(body.code_challenge_methods_supported).toContain('S256');
  });
});

test.describe('OAuth — CORS preflight on /mcp (9.5)', () => {
  test('allowed origin sees ACAO; disallowed origin omits it', async ({ request }) => {
    const allowed = await request.fetch(`${BACKEND}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://claude.ai',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect([200, 204]).toContain(allowed.status());
    expect(allowed.headers()['access-control-allow-origin']).toBe('https://claude.ai');

    const disallowed = await request.fetch(`${BACKEND}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://attacker.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    // Must NOT echo the disallowed origin back.
    expect(disallowed.headers()['access-control-allow-origin']).not.toBe('https://attacker.example.com');
  });
});

test.describe('OAuth — WWW-Authenticate on /mcp (10.3)', () => {
  test('unauthenticated POST /mcp returns 401 with WWW-Authenticate header', async ({ request }) => {
    const res = await request.post(`${BACKEND}/mcp`, { data: { jsonrpc: '2.0', method: 'initialize', id: 1 } });
    expect(res.status()).toBe(401);
    const challenge = res.headers()['www-authenticate'];
    expect(challenge).toBeTruthy();
    expect(challenge).toMatch(/Bearer realm="kalepin"/);
    expect(challenge).toMatch(/resource_metadata=/);
  });

  test('invalid bearer token gets error="invalid_token"', async ({ request }) => {
    const res = await request.post(`${BACKEND}/mcp`, {
      headers: { authorization: 'Bearer kpoa_at_definitely-not-real' },
      data: { jsonrpc: '2.0', method: 'initialize', id: 1 },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

test.describe('OAuth — full flow (16.1)', () => {
  test('DCR → authorize → approve → token exchange → /mcp call', async ({ request }) => {
    const { token: jwtToken } = makeJwt('e2e-flow@example.com');
    const client = await registerClient(request);
    const { verifier, challenge } = pkce();
    const requestId = await startAuthorize(request, {
      clientId: client.client_id,
      redirectUri: 'https://example.com/cb',
      challenge,
      scope: 'notes.read',
    });
    const code = await approve(request, jwtToken, requestId);
    const tokens = await exchangeCode(request, {
      code,
      redirectUri: 'https://example.com/cb',
      clientId: client.client_id,
      verifier,
    });
    expect(tokens.access_token).toMatch(/^kpoa_at_/);
    expect(tokens.refresh_token).toMatch(/^kpoa_rt_/);

    // The minted access token should let us reach /mcp.
    const mcpRes = await request.post(`${BACKEND}/mcp`, {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
      },
    });
    expect(mcpRes.status()).toBe(200);
  });
});

test.describe('OAuth — refresh rotation (16.2)', () => {
  test('rotate succeeds and within-leeway retry re-emits the same pair', async ({ request }) => {
    const { token: jwtToken } = makeJwt('e2e-rotate@example.com');
    const client = await registerClient(request);
    const { verifier, challenge } = pkce();
    const requestId = await startAuthorize(request, {
      clientId: client.client_id,
      redirectUri: 'https://example.com/cb',
      challenge,
      scope: 'notes.read',
    });
    const code = await approve(request, jwtToken, requestId);
    const tokens = await exchangeCode(request, {
      code,
      redirectUri: 'https://example.com/cb',
      clientId: client.client_id,
      verifier,
    });

    const refreshed = await request.post(`${BACKEND}/oauth/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      },
    });
    expect(refreshed.status()).toBe(200);
    const body = await refreshed.json();
    expect(body.access_token).not.toBe(tokens.access_token);
    expect(body.refresh_token).not.toBe(tokens.refresh_token);

    // Re-presenting the original (consumed) refresh token within leeway re-emits the same pair.
    const retry = await request.post(`${BACKEND}/oauth/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      },
    });
    expect(retry.status()).toBe(200);
    const retryBody = await retry.json();
    expect(retryBody.access_token).toBe(body.access_token);
    expect(retryBody.refresh_token).toBe(body.refresh_token);
  });
});

test.describe('OAuth — scope downgrade (16.4)', () => {
  test('granting notes.read on a notes.write request restricts the access token scope', async ({ request }) => {
    const { token: jwtToken } = makeJwt('e2e-downgrade@example.com');
    const client = await registerClient(request);
    const { verifier, challenge } = pkce();
    const requestId = await startAuthorize(request, {
      clientId: client.client_id,
      redirectUri: 'https://example.com/cb',
      challenge,
      scope: 'notes.read notes.comment notes.write',
    });
    const code = await approve(request, jwtToken, requestId, ['notes.read']);
    const tokens = await exchangeCode(request, {
      code,
      redirectUri: 'https://example.com/cb',
      clientId: client.client_id,
      verifier,
    });
    expect(tokens.scope).toBe('notes.read');
  });
});

test.describe('OAuth — grant revocation (16.5)', () => {
  test('DELETE /api/oauth/grants kills in-flight access tokens', async ({ request }) => {
    const { token: jwtToken } = makeJwt('e2e-revoke@example.com');
    const client = await registerClient(request);
    const { verifier, challenge } = pkce();
    const requestId = await startAuthorize(request, {
      clientId: client.client_id,
      redirectUri: 'https://example.com/cb',
      challenge,
      scope: 'notes.read',
    });
    const code = await approve(request, jwtToken, requestId);
    const tokens = await exchangeCode(request, {
      code,
      redirectUri: 'https://example.com/cb',
      clientId: client.client_id,
      verifier,
    });

    const grants = await request.get(`${BACKEND}/api/oauth/grants`, {
      headers: { authorization: `Bearer ${jwtToken}` },
    });
    expect(grants.status()).toBe(200);
    const grantList = await grants.json();
    expect(grantList.length).toBeGreaterThan(0);
    const grantId = grantList[0].id;

    const del = await request.delete(`${BACKEND}/api/oauth/grants/${grantId}`, {
      headers: { authorization: `Bearer ${jwtToken}` },
    });
    expect(del.status()).toBe(200);

    // Access token now fails with 401.
    const after = await request.post(`${BACKEND}/mcp`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      data: { jsonrpc: '2.0', method: 'initialize', id: 1 },
    });
    expect(after.status()).toBe(401);
  });
});

test.describe('OAuth — replay outside leeway (16.3)', () => {
  // Waits past the 30s leeway window, so allow ~75s.
  test('replaying a consumed refresh token after the leeway window kills the chain', async ({ request }) => {
    test.setTimeout(75_000);
    const { token: jwtToken } = makeJwt('e2e-replay@example.com');
    const client = await registerClient(request);
    const { verifier, challenge } = pkce();
    const requestId = await startAuthorize(request, {
      clientId: client.client_id,
      redirectUri: 'https://example.com/cb',
      challenge,
      scope: 'notes.read',
    });
    const code = await approve(request, jwtToken, requestId);
    const tokens = await exchangeCode(request, {
      code,
      redirectUri: 'https://example.com/cb',
      clientId: client.client_id,
      verifier,
    });

    // First rotation succeeds.
    const rotated = await request.post(`${BACKEND}/oauth/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      },
    });
    expect(rotated.status()).toBe(200);
    const rotatedBody = await rotated.json();

    // Wait past the 30-second leeway window so the next replay drops into
    // the chain-revocation branch rather than the leeway re-emit branch.
    await new Promise((r) => setTimeout(r, 31_000));

    // Replaying the original (consumed) refresh token now triggers replay detection.
    const replay = await request.post(`${BACKEND}/oauth/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      },
    });
    expect(replay.status()).toBe(400);
    const replayBody = await replay.json();
    expect(replayBody.error).toBe('invalid_grant');

    // Chain revocation: the rotated access token must now be 401.
    const after = await request.post(`${BACKEND}/mcp`, {
      headers: { authorization: `Bearer ${rotatedBody.access_token}` },
      data: { jsonrpc: '2.0', method: 'initialize', id: 1 },
    });
    expect(after.status()).toBe(401);

    // And the new refresh token from the rotation is also revoked.
    const refreshAfter = await request.post(`${BACKEND}/oauth/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: rotatedBody.refresh_token,
        client_id: client.client_id,
      },
    });
    expect(refreshAfter.status()).toBe(400);
  });
});

test.describe('OAuth — session/user binding (16.6)', () => {
  test('reusing user A\'s Mcp-Session-Id while authenticated as user B returns 403', async ({ request }) => {
    const userA = makeJwt('e2e-sid-a@example.com');
    const userB = makeJwt('e2e-sid-b@example.com');

    // User A initialises a session and we capture the Mcp-Session-Id header.
    const initA = await request.post(`${BACKEND}/mcp`, {
      headers: {
        authorization: `Bearer ${userA.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
      },
    });
    expect(initA.status()).toBe(200);
    const sid = initA.headers()['mcp-session-id'];
    expect(sid).toBeTruthy();

    // User B presents the same Mcp-Session-Id — must be rejected with 403.
    const cross = await request.post(`${BACKEND}/mcp`, {
      headers: {
        authorization: `Bearer ${userB.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
      },
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });
    expect(cross.status()).toBe(403);
    const body = await cross.json();
    expect(body.error).toBe('session_user_mismatch');

    // User A's session must remain usable (the rejected request didn't touch it).
    const followup = await request.post(`${BACKEND}/mcp`, {
      headers: {
        authorization: `Bearer ${userA.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
      },
      data: { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    });
    expect(followup.status()).toBe(200);
  });
});

test.describe('OAuth — parallel refresh under per-grant lock (16.8)', () => {
  test('two concurrent /oauth/token calls on the same grant return the same pair without splitting the chain', async ({ request }) => {
    const { token: jwtToken } = makeJwt('e2e-parallel@example.com');
    const client = await registerClient(request);
    const { verifier, challenge } = pkce();
    const requestId = await startAuthorize(request, {
      clientId: client.client_id,
      redirectUri: 'https://example.com/cb',
      challenge,
      scope: 'notes.read',
    });
    const code = await approve(request, jwtToken, requestId);
    const tokens = await exchangeCode(request, {
      code,
      redirectUri: 'https://example.com/cb',
      clientId: client.client_id,
      verifier,
    });

    // Fire two refresh calls in parallel with the same refresh token. The lock
    // serialises them: one rotates, the other lands inside the leeway window and
    // re-emits the same pair. Both must succeed and return identical tokens.
    const fire = () =>
      request.post(`${BACKEND}/oauth/token`, {
        form: {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: client.client_id,
        },
      });
    const [a, b] = await Promise.all([fire(), fire()]);

    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
    const aBody = await a.json();
    const bBody = await b.json();
    expect(aBody.access_token).toBe(bBody.access_token);
    expect(aBody.refresh_token).toBe(bBody.refresh_token);
    expect(aBody.refresh_token).not.toBe(tokens.refresh_token);

    // The chain is intact: the new RT can rotate again.
    const next = await request.post(`${BACKEND}/oauth/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: aBody.refresh_token,
        client_id: client.client_id,
      },
    });
    expect(next.status()).toBe(200);
  });
});

test.describe('OAuth — device-aware grants (16.9)', () => {
  test('two clients with distinct software_ids coexist; revoking one leaves the other live', async ({ request }) => {
    const { token: jwtToken } = makeJwt('e2e-devices@example.com');

    // Two DCR registrations from "the same" app on different platforms — distinct
    // software_id values produce distinct device_label keys, so the grants live
    // side-by-side rather than the second replacing the first.
    const registerWithSoftwareId = async (softwareId: string) => {
      const res = await request.post(`${BACKEND}/oauth/register`, {
        data: {
          client_name: 'Device-aware app',
          redirect_uris: ['https://example.com/cb'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          software_id: softwareId,
        },
      });
      expect(res.status()).toBe(201);
      return await res.json();
    };

    const authorizeAndExchange = async (clientId: string) => {
      const { verifier, challenge } = pkce();
      const requestId = await startAuthorize(request, {
        clientId,
        redirectUri: 'https://example.com/cb',
        challenge,
        scope: 'notes.read',
      });
      const code = await approve(request, jwtToken, requestId);
      return await exchangeCode(request, {
        code,
        redirectUri: 'https://example.com/cb',
        clientId,
        verifier,
      });
    };

    const clientWeb = await registerWithSoftwareId('e2e-app-web');
    const clientCli = await registerWithSoftwareId('e2e-app-cli');

    const tokensWeb = await authorizeAndExchange(clientWeb.client_id);
    const tokensCli = await authorizeAndExchange(clientCli.client_id);

    // Both grants are listed for the user.
    const grantsRes = await request.get(`${BACKEND}/api/oauth/grants`, {
      headers: { authorization: `Bearer ${jwtToken}` },
    });
    expect(grantsRes.status()).toBe(200);
    const grants = await grantsRes.json();
    const webGrant = grants.find((g: { client_id: string }) => g.client_id === clientWeb.client_id);
    const cliGrant = grants.find((g: { client_id: string }) => g.client_id === clientCli.client_id);
    expect(webGrant).toBeTruthy();
    expect(cliGrant).toBeTruthy();

    // Revoke the web grant only.
    const del = await request.delete(`${BACKEND}/api/oauth/grants/${webGrant.id}`, {
      headers: { authorization: `Bearer ${jwtToken}` },
    });
    expect(del.status()).toBe(200);

    // The web grant's refresh token is now invalid (chain revoked).
    const webRefresh = await request.post(`${BACKEND}/oauth/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokensWeb.refresh_token,
        client_id: clientWeb.client_id,
      },
    });
    expect(webRefresh.status()).toBe(400);

    // The CLI grant is untouched: its refresh token still rotates successfully.
    const cliRefresh = await request.post(`${BACKEND}/oauth/token`, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokensCli.refresh_token,
        client_id: clientCli.client_id,
      },
    });
    expect(cliRefresh.status()).toBe(200);

    // And only the CLI grant remains in the user's connections list.
    const grantsAfterRes = await request.get(`${BACKEND}/api/oauth/grants`, {
      headers: { authorization: `Bearer ${jwtToken}` },
    });
    const grantsAfter = await grantsAfterRes.json() as Array<{ client_id: string }>;
    expect(grantsAfter).toHaveLength(1);
    expect(grantsAfter[0].client_id).toBe(clientCli.client_id);
  });
});

test.describe('OAuth — regression: existing API-key MCP flow (16.7)', () => {
  test('JWT/API-key MCP requests still work', async ({ request }) => {
    const { token: jwtToken } = makeJwt('e2e-regression@example.com');
    const res = await request.post(`${BACKEND}/mcp`, {
      headers: {
        authorization: `Bearer ${jwtToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
      },
    });
    expect(res.status()).toBe(200);
  });
});
