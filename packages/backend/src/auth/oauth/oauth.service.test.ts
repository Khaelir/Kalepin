import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash, randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import {
  OAuthClient,
  OAuthAuthorizationRequest,
  OAuthAuthorizationCode,
  OAuthGrant,
  OAuthAccessToken,
  OAuthRefreshToken,
  User,
} from '../../entities';
import { OAuthService, OAuthError } from './oauth.service';
import { GrantLock } from './grant-lock';
import { OAuthEventBus, type OAuthRefreshEvent, type OAuthGrantRevokedEvent } from './oauth.events';

let ds: DataSource;
let svc: OAuthService;
let bus: OAuthEventBus;
const refreshEvents: OAuthRefreshEvent[] = [];
const grantRevokedEvents: OAuthGrantRevokedEvent[] = [];

async function setup() {
  refreshEvents.length = 0;
  grantRevokedEvents.length = 0;

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [
      User,
      OAuthClient,
      OAuthAuthorizationRequest,
      OAuthAuthorizationCode,
      OAuthGrant,
      OAuthAccessToken,
      OAuthRefreshToken,
    ],
    synchronize: true,
  });
  await ds.initialize();

  bus = new OAuthEventBus();
  bus.onRefresh((ev) => { refreshEvents.push(ev); });
  bus.onGrantRevoked((ev) => { grantRevokedEvents.push(ev); });

  svc = new OAuthService(
    ds.getRepository(OAuthClient),
    ds.getRepository(OAuthAuthorizationRequest),
    ds.getRepository(OAuthAuthorizationCode),
    ds.getRepository(OAuthGrant),
    ds.getRepository(OAuthAccessToken),
    ds.getRepository(OAuthRefreshToken),
    ds.getRepository(User),
    new GrantLock(),
    bus,
  );
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

async function makeUser(email = 'u@example.com'): Promise<User> {
  return ds.getRepository(User).save({ email, completedTours: [] } as Partial<User>);
}

interface RegisteredClient {
  client_id: string;
}

async function registerWebClient(redirectUri = 'https://example.com/cb'): Promise<RegisteredClient> {
  const r = await svc.registerClient({
    client_name: 'Test client',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  return { client_id: r.client_id };
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

describe('OAuthService — DCR (registerClient)', () => {
  beforeEach(setup);
  after(teardown);

  it('rejects empty redirect_uris', async () => {
    await assert.rejects(
      svc.registerClient({ client_name: 'x', redirect_uris: [], grant_types: ['authorization_code'], response_types: ['code'] }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_redirect_uri',
    );
  });

  it('rejects http URLs that are not localhost', async () => {
    await assert.rejects(
      svc.registerClient({
        client_name: 'x',
        redirect_uris: ['http://attacker.example.com/cb'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_redirect_uri',
    );
  });

  it('allows http://localhost and 127.0.0.1 for development clients', async () => {
    const a = await svc.registerClient({
      client_name: 'dev',
      redirect_uris: ['http://localhost:8080/cb'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
    assert.ok(a.client_id.startsWith('kpoc_'));
    const b = await svc.registerClient({
      client_name: 'dev',
      redirect_uris: ['http://127.0.0.1:9000/cb'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
    assert.ok(b.client_id.startsWith('kpoc_'));
  });

  it('rejects redirect URIs with a fragment', async () => {
    await assert.rejects(
      svc.registerClient({
        client_name: 'x',
        redirect_uris: ['https://example.com/cb#frag'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_redirect_uri',
    );
  });

  it('rejects malformed redirect URI strings', async () => {
    await assert.rejects(
      svc.registerClient({
        client_name: 'x',
        redirect_uris: ['not a url'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_redirect_uri',
    );
  });

  it('persists verified=false for unknown software_id', async () => {
    const result = await svc.registerClient({
      client_name: 'unknown app',
      software_id: 'definitely-not-on-the-list',
      redirect_uris: ['https://example.com/cb'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
    const row = await ds.getRepository(OAuthClient).findOneByOrFail({ clientId: result.client_id });
    assert.equal(row.verified, false);
  });
});

describe('OAuthService — authorization-code exchange', () => {
  beforeEach(setup);
  after(teardown);

  async function bootCodeFlow(redirectUri = 'https://example.com/cb', codeVerifier = 'a'.repeat(64)) {
    const user = await makeUser();
    const client = await registerWebClient(redirectUri);
    const start = await svc.startAuthorization({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: 'notes.read notes.comment',
      state: 'xyz',
      code_challenge: s256(codeVerifier),
      code_challenge_method: 'S256',
    });
    if ('redirectError' in start) throw new Error('unexpected redirectError');
    const approve = await svc.approveAuthorization(start.requestId, user.id, undefined);
    return { client, redirectUri, codeVerifier, rawCode: approve.rawCode, user };
  }

  it('issues access + refresh tokens on a valid PKCE exchange', async () => {
    const { client, redirectUri, codeVerifier, rawCode } = await bootCodeFlow();
    const result = await svc.exchangeAuthorizationCode({
      code: rawCode,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: codeVerifier,
    });
    assert.ok(result.access_token.startsWith('kpoa_at_'));
    assert.ok(result.refresh_token.startsWith('kpoa_rt_'));
    assert.equal(result.token_type, 'Bearer');
    assert.equal(result.expires_in, 3600);
  });

  it('rejects on PKCE verifier mismatch and consumes the code', async () => {
    const { client, redirectUri, rawCode } = await bootCodeFlow();
    await assert.rejects(
      svc.exchangeAuthorizationCode({
        code: rawCode,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: 'wrong-verifier',
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_grant',
    );
    // Code is now marked consumed; same verifier no longer works.
    await assert.rejects(
      svc.exchangeAuthorizationCode({
        code: rawCode,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: 'a'.repeat(64),
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_grant',
    );
  });

  it('rejects code reuse (single-use)', async () => {
    const { client, redirectUri, codeVerifier, rawCode } = await bootCodeFlow();
    await svc.exchangeAuthorizationCode({
      code: rawCode,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: codeVerifier,
    });
    await assert.rejects(
      svc.exchangeAuthorizationCode({
        code: rawCode,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: codeVerifier,
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_grant',
    );
  });

  it('rejects redirect_uri mismatch on exchange', async () => {
    const { client, codeVerifier, rawCode } = await bootCodeFlow();
    await assert.rejects(
      svc.exchangeAuthorizationCode({
        code: rawCode,
        redirect_uri: 'https://attacker.example.com/cb',
        client_id: client.client_id,
        code_verifier: codeVerifier,
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_grant',
    );
  });
});

describe('OAuthService — refresh rotation', () => {
  beforeEach(setup);
  after(teardown);

  async function bootGrant() {
    const user = await makeUser();
    const redirectUri = 'https://example.com/cb';
    const codeVerifier = 'a'.repeat(64);
    const client = await registerWebClient(redirectUri);
    const start = await svc.startAuthorization({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: 'notes.read',
      code_challenge: s256(codeVerifier),
      code_challenge_method: 'S256',
    });
    if ('redirectError' in start) throw new Error('unexpected redirectError');
    const approve = await svc.approveAuthorization(start.requestId, user.id, undefined);
    const tokens = await svc.exchangeAuthorizationCode({
      code: approve.rawCode,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: codeVerifier,
    });
    return { client, tokens, user };
  }

  it('rotates refresh tokens and emits oauth.refresh', async () => {
    const { client, tokens } = await bootGrant();
    refreshEvents.length = 0;
    const next = await svc.refreshTokens({
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });
    assert.notEqual(next.access_token, tokens.access_token);
    assert.notEqual(next.refresh_token, tokens.refresh_token);
    assert.equal(next.usedLeeway, false);
    assert.equal(refreshEvents.length, 1);
    assert.equal(refreshEvents[0].kind, 'refresh');
    assert.equal(refreshEvents[0].success, true);
  });

  it('re-emits the same pair within the 30-second leeway window', async () => {
    const { client, tokens } = await bootGrant();
    const first = await svc.refreshTokens({
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });
    refreshEvents.length = 0;

    // Replay the original (now consumed) refresh token within the window.
    const replay = await svc.refreshTokens({
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });
    assert.equal(replay.access_token, first.access_token);
    assert.equal(replay.refresh_token, first.refresh_token);
    assert.equal(replay.usedLeeway, true);
    assert.equal(refreshEvents.length, 1);
    assert.equal(refreshEvents[0].kind, 'leeway');
    // The original grant must remain live.
    assert.equal(grantRevokedEvents.length, 0);
  });

  it('outside the leeway window, replay revokes the chain', async () => {
    const { client, tokens } = await bootGrant();
    await svc.refreshTokens({
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });

    // Force the consumed row to look like it rotated > 30s ago.
    const repo = ds.getRepository(OAuthRefreshToken);
    const consumed = await repo.findOneByOrFail({
      tokenHash: createHash('sha256').update(tokens.refresh_token).digest('hex'),
    });
    consumed.replacedAt = new Date(Date.now() - 60_000);
    await repo.save(consumed);

    refreshEvents.length = 0;
    grantRevokedEvents.length = 0;

    await assert.rejects(
      svc.refreshTokens({
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_grant',
    );

    assert.equal(refreshEvents.find((e) => e.kind === 'replay_detected') !== undefined, true);
    assert.equal(grantRevokedEvents.length, 1);
    assert.equal(grantRevokedEvents[0].reason, 'replay');
  });

  it('refuses refresh after grant.absoluteExpiresAt has passed', async () => {
    const { client, tokens, user } = await bootGrant();
    const grantRepo = ds.getRepository(OAuthGrant);
    const grant = await grantRepo.findOneByOrFail({ userId: user.id, revokedAt: null as unknown as Date });
    grant.absoluteExpiresAt = new Date(Date.now() - 1000);
    await grantRepo.save(grant);

    await assert.rejects(
      svc.refreshTokens({
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      }),
      (err: unknown) => err instanceof OAuthError && err.code === 'invalid_grant',
    );
    // Absolute-cap path revokes the grant with reason=expired.
    assert.equal(grantRevokedEvents.find((e) => e.reason === 'expired') !== undefined, true);
  });

  it('serializes parallel refreshes through the per-grant lock', async () => {
    const { client, tokens } = await bootGrant();
    const [a, b] = await Promise.all([
      svc.refreshTokens({ refresh_token: tokens.refresh_token, client_id: client.client_id }),
      svc.refreshTokens({ refresh_token: tokens.refresh_token, client_id: client.client_id }),
    ]);
    // First call rotates; second hits the leeway memo and re-emits the same pair.
    const aRotated = a.usedLeeway === false;
    const bRotated = b.usedLeeway === false;
    assert.notEqual(aRotated, bRotated, 'exactly one of the two parallel refreshes should rotate');
    assert.equal(a.access_token, b.access_token);
    assert.equal(a.refresh_token, b.refresh_token);
    // Chain stays alive.
    assert.equal(grantRevokedEvents.filter((e) => e.reason === 'replay').length, 0);
  });
});

describe('OAuthService — verifyAccessToken & grant management', () => {
  beforeEach(setup);
  after(teardown);

  async function bootGrant() {
    const user = await makeUser();
    const redirectUri = 'https://example.com/cb';
    const codeVerifier = 'a'.repeat(64);
    const client = await registerWebClient(redirectUri);
    const start = await svc.startAuthorization({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: 'notes.read notes.comment notes.write',
      code_challenge: s256(codeVerifier),
      code_challenge_method: 'S256',
    });
    if ('redirectError' in start) throw new Error('unexpected redirectError');
    const approve = await svc.approveAuthorization(start.requestId, user.id, undefined);
    const tokens = await svc.exchangeAuthorizationCode({
      code: approve.rawCode,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: codeVerifier,
    });
    return { client, tokens, user };
  }

  it('resolves a valid access token to {sub, email, scope}', async () => {
    const { tokens, user } = await bootGrant();
    const resolved = await svc.verifyAccessToken(tokens.access_token);
    assert.equal(resolved.sub, user.id);
    assert.equal(resolved.email, user.email);
    assert.equal(resolved.scope, 'rw');
    assert.notEqual(resolved.scope as string, 'admin');
  });

  it('rejects expired access tokens', async () => {
    const { tokens } = await bootGrant();
    const repo = ds.getRepository(OAuthAccessToken);
    const at = await repo.findOneByOrFail({
      tokenHash: createHash('sha256').update(tokens.access_token).digest('hex'),
    });
    at.expiresAt = new Date(Date.now() - 1000);
    await repo.save(at);

    await assert.rejects(svc.verifyAccessToken(tokens.access_token));
  });

  it('rejects revoked access tokens', async () => {
    const { tokens } = await bootGrant();
    const repo = ds.getRepository(OAuthAccessToken);
    const at = await repo.findOneByOrFail({
      tokenHash: createHash('sha256').update(tokens.access_token).digest('hex'),
    });
    at.revokedAt = new Date();
    await repo.save(at);

    await assert.rejects(svc.verifyAccessToken(tokens.access_token));
  });

  it('rejects access tokens whose grant has been revoked', async () => {
    const { tokens, user } = await bootGrant();
    const grants = await svc.listGrantsForUser(user.id);
    assert.equal(grants.length, 1);
    await svc.revokeGrant(grants[0].id, 'user');
    await assert.rejects(svc.verifyAccessToken(tokens.access_token));
  });

  it('listGrantsForUser returns active grants only', async () => {
    const { user } = await bootGrant();
    const grants = await svc.listGrantsForUser(user.id);
    assert.equal(grants.length, 1);
    assert.equal(typeof grants[0].client_name, 'string');
    assert.ok(grants[0].created_at);
  });

  it('revokeGrantForUser blocks cross-user revocation (404 path)', async () => {
    const { user } = await bootGrant();
    const grants = await svc.listGrantsForUser(user.id);
    const stranger = await makeUser('stranger@example.com');
    const ok = await svc.revokeGrantForUser(stranger.id, grants[0].id);
    assert.equal(ok, false);
    // Owner can still revoke.
    const okOwner = await svc.revokeGrantForUser(user.id, grants[0].id);
    assert.equal(okOwner, true);
  });

  it('revokeToken on the refresh token kills the entire chain', async () => {
    const { client, tokens } = await bootGrant();
    const next = await svc.refreshTokens({ refresh_token: tokens.refresh_token, client_id: client.client_id });
    grantRevokedEvents.length = 0;
    await svc.revokeToken(next.refresh_token, 'refresh_token');
    assert.equal(grantRevokedEvents.length, 1);
    // Subsequent refresh fails.
    await assert.rejects(
      svc.refreshTokens({ refresh_token: next.refresh_token, client_id: client.client_id }),
    );
  });
});

// Touch a couple of helper imports to silence "unused" warnings — these are
// referenced in tests above. randomBytes/refreshEvents/etc. are intentionally
// shared across describe blocks via module-scope variables.
void randomBytes;
