import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthService } from '../auth.service';
import { MagicLinkToken } from '../../entities/magic-link-token.entity';
import { User } from '../../entities/user.entity';
import { SsoLoginRequest } from '../../entities/sso-login-request.entity';
import { UserIdentity } from '../../entities/user-identity.entity';
import { ExternalIdentity, IdentityProvider, SsoError } from './identity-provider';
import { SsoProviderRegistry } from './sso-providers';
import { SsoService, SsoCompletion } from './sso.service';

const ORIG_ENV = { ...process.env };
const ISS = 'https://login.example/tenant/v2.0';

class FakeProvider implements IdentityProvider {
  readonly label: string;
  readonly redirectUri = 'https://kalepin.example.com/api/auth/sso/microsoft/callback';
  identity: ExternalIdentity = { issuer: ISS, subject: 'oid-1', emails: ['alice@company.com'], displayName: 'Alice Smith' };
  authorizeError?: Error;
  exchangeError?: Error;
  exchanges: { query: URLSearchParams; state: string; nonce: string; codeVerifier: string }[] = [];
  lastChallenge?: string;

  constructor(readonly id = 'microsoft') {
    this.label = id;
  }

  async authorizationUrl(p: { state: string; nonce: string; codeChallenge: string }): Promise<URL> {
    if (this.authorizeError) throw this.authorizeError;
    this.lastChallenge = p.codeChallenge;
    return new URL(`https://idp.example/authorize?state=${p.state}`);
  }

  async exchange(p: { query: URLSearchParams; state: string; nonce: string; codeVerifier: string }): Promise<ExternalIdentity> {
    this.exchanges.push(p);
    if (this.exchangeError) throw this.exchangeError;
    return this.identity;
  }
}

let ds: DataSource;
let provider: FakeProvider;
let other: FakeProvider;
let service: SsoService;
let personalFolders: string[];

function build(allowlist = '*') {
  process.env.DOMAIN_ALLOWLIST = allowlist;
  const storage = { ensurePersonalFolder: async (email: string) => void personalFolders.push(email) };
  const auth = new AuthService(ds.getRepository(User), ds.getRepository(MagicLinkToken), {} as any, undefined, storage);
  const registry = new SsoProviderRegistry({ warnings: [] });
  registry.register(provider);
  registry.register(other);
  service = new SsoService(
    registry,
    auth,
    ds.getRepository(SsoLoginRequest),
    ds.getRepository(UserIdentity),
    ds.getRepository(User),
  );
  return auth;
}

async function startFlow(returnTo: unknown = '/doc/Notes.md', now?: Date) {
  const { authorizationUrl, binding } = await service.start('microsoft', returnTo, now);
  const state = authorizationUrl.searchParams.get('state')!;
  return { state, binding, query: new URLSearchParams({ code: 'the-code', state }) };
}

function assertFailed(result: SsoCompletion, code: string, returnTo = '/doc/Notes.md') {
  assert.deepEqual(result, { ok: false, returnTo, code });
}

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret';
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [User, MagicLinkToken, SsoLoginRequest, UserIdentity],
    synchronize: true,
  });
  await ds.initialize();
  provider = new FakeProvider();
  other = new FakeProvider('other');
  personalFolders = [];
  build();
});

afterEach(async () => {
  if (ds?.isInitialized) await ds.destroy();
  process.env = { ...ORIG_ENV };
});

describe('SsoService.start', () => {
  it('stores a single-use, 10-minute request with a hashed browser binding', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const { state, binding } = await startFlow('/doc/Notes.md', now);
    const row = await ds.getRepository(SsoLoginRequest).findOneByOrFail({ state });
    assert.equal(row.provider, 'microsoft');
    assert.equal(row.returnTo, '/doc/Notes.md');
    assert.equal(row.usedAt, null);
    assert.equal(row.expiresAt.toISOString(), '2026-01-01T00:10:00.000Z');
    assert.equal(row.bindingHash, createHash('sha256').update(binding).digest('hex'));
    assert.notEqual(row.bindingHash, binding);
    assert.equal(provider.lastChallenge, createHash('sha256').update(row.codeVerifier).digest('base64url'));
    assert.ok(state.length >= 43 && row.nonce.length >= 43 && binding.length >= 43);
  });

  it('stores / for an off-origin returnTo', async () => {
    const { state } = await startFlow('//evil.example/');
    assert.equal((await ds.getRepository(SsoLoginRequest).findOneByOrFail({ state })).returnTo, '/');
  });

  it('stores nothing when the provider is unavailable', async () => {
    provider.authorizeError = new SsoError('unavailable');
    await assert.rejects(() => service.start('microsoft', '/'), (err: unknown) => err instanceof SsoError && err.code === 'unavailable');
    assert.equal(await ds.getRepository(SsoLoginRequest).count(), 0);
  });
});

describe('SsoService.complete: request consumption', () => {
  it('refuses an unknown or missing state', async () => {
    assertFailed(await service.complete('microsoft', new URLSearchParams({ state: 'nope' }), 'x'), 'expired', '/');
    assertFailed(await service.complete('microsoft', new URLSearchParams(), 'x'), 'expired', '/');
    assert.equal(provider.exchanges.length, 0);
  });

  it('refuses an expired request', async () => {
    const { query, binding } = await startFlow();
    const later = new Date(Date.now() + 11 * 60 * 1000);
    assertFailed(await service.complete('microsoft', query, binding, later), 'expired');
    assert.equal(provider.exchanges.length, 0);
  });

  it('refuses a replayed state', async () => {
    const { query, binding } = await startFlow();
    assert.equal((await service.complete('microsoft', query, binding)).ok, true);
    assertFailed(await service.complete('microsoft', query, binding), 'expired');
    assert.equal(provider.exchanges.length, 1);
  });

  it('refuses and consumes a state started for another provider', async () => {
    const { query, binding } = await startFlow();
    assertFailed(await service.complete('other', query, binding), 'expired');
    assertFailed(await service.complete('microsoft', query, binding), 'expired');
    assert.equal(provider.exchanges.length + other.exchanges.length, 0);
  });

  it('refuses and consumes the request when the cookie is missing', async () => {
    const { query, binding } = await startFlow();
    assertFailed(await service.complete('microsoft', query, undefined), 'expired');
    assertFailed(await service.complete('microsoft', query, binding), 'expired');
    assert.equal(provider.exchanges.length, 0);
  });

  it('refuses and consumes the request when the cookie does not match', async () => {
    const { query, binding } = await startFlow();
    assertFailed(await service.complete('microsoft', query, `${binding}x`), 'expired');
    assertFailed(await service.complete('microsoft', query, binding), 'expired');
    assert.equal(provider.exchanges.length, 0);
  });

  it('stays single-use when the exchange throws', async () => {
    const { query, binding } = await startFlow();
    provider.exchangeError = new SsoError('provider_error');
    assertFailed(await service.complete('microsoft', query, binding), 'provider_error');
    provider.exchangeError = undefined;
    assertFailed(await service.complete('microsoft', query, binding), 'expired');
    assert.equal(provider.exchanges.length, 1);
  });

  it('passes the stored state, nonce and verifier to the exchange', async () => {
    const { query, binding, state } = await startFlow();
    await service.complete('microsoft', query, binding);
    const row = await ds.getRepository(SsoLoginRequest).findOneByOrFail({ state });
    assert.deepEqual(provider.exchanges[0], { query, state, nonce: row.nonce, codeVerifier: row.codeVerifier });
    assert.ok(row.usedAt instanceof Date);
  });
});

describe('SsoService.complete: sign-in', () => {
  it('signs in an existing user, records the identity and fills the display name', async () => {
    const auth = build();
    const alice = await auth.createUser('alice@company.com');
    const { query, binding } = await startFlow('/#/oauth/consent?request_id=abc');
    const result = await service.complete('microsoft', query, binding);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.returnTo, '/#/oauth/consent?request_id=abc');
    assert.equal(result.userId, alice.id);
    assert.deepEqual(
      { sub: auth.verifyToken(result.sessionToken).sub, email: auth.verifyToken(result.sessionToken).email },
      { sub: alice.id, email: 'alice@company.com' },
    );
    assert.deepEqual(personalFolders, ['alice@company.com']);
    assert.equal(await ds.getRepository(User).count(), 1);
    assert.equal((await ds.getRepository(User).findOneByOrFail({ id: alice.id })).displayName, 'Alice Smith');
    const identity = await ds.getRepository(UserIdentity).findOneByOrFail({ subject: 'oid-1' });
    assert.deepEqual(
      { userId: identity.userId, provider: identity.provider, issuer: identity.issuer, emailAtLink: identity.emailAtLink },
      { userId: alice.id, provider: 'microsoft', issuer: ISS, emailAtLink: 'alice@company.com' },
    );
  });

  it('keeps an existing display name', async () => {
    const auth = build();
    const alice = await auth.createUser('alice@company.com');
    await ds.getRepository(User).update({ id: alice.id }, { displayName: 'Ali' });
    const { query, binding } = await startFlow();
    await service.complete('microsoft', query, binding);
    assert.equal((await ds.getRepository(User).findOneByOrFail({ id: alice.id })).displayName, 'Ali');
  });

  it('creates a new user with the first candidate', async () => {
    provider.identity = { ...provider.identity, emails: ['New@Company.com', 'upn@company.com'] };
    const { query, binding } = await startFlow();
    const result = await service.complete('microsoft', query, binding);
    assert.equal(result.ok, true);
    const users = await ds.getRepository(User).find();
    assert.deepEqual(users.map((u) => u.email), ['new@company.com']);
    assert.deepEqual(personalFolders, ['new@company.com']);
  });

  it('refuses a domain outside the allowlist without creating a user', async () => {
    build('company.com');
    provider.identity = { ...provider.identity, emails: ['alice@other.com'] };
    const { query, binding } = await startFlow('/#/oauth/consent?request_id=abc');
    assertFailed(await service.complete('microsoft', query, binding), 'domain_not_allowed', '/#/oauth/consent?request_id=abc');
    assert.equal(await ds.getRepository(User).count(), 0);
    assert.equal(await ds.getRepository(UserIdentity).count(), 0);
  });

  it('refuses when the candidates match two users', async () => {
    const auth = build();
    await auth.createUser('alice@company.com');
    await auth.createUser('a.smith@company.com');
    provider.identity = { ...provider.identity, emails: ['a.smith@company.com', 'alice@company.com'] };
    const { query, binding } = await startFlow();
    assertFailed(await service.complete('microsoft', query, binding), 'ambiguous_account');
    assert.equal(await ds.getRepository(UserIdentity).count(), 0);
  });

  it('passes provider error codes through', async () => {
    for (const code of ['cancelled', 'wrong_tenant'] as const) {
      provider.exchangeError = new SsoError(code);
      const { query, binding } = await startFlow();
      assertFailed(await service.complete('microsoft', query, binding), code);
    }
  });

  it('maps an unexpected error to provider_error', async () => {
    provider.exchangeError = new Error('socket hang up');
    const { query, binding } = await startFlow();
    assertFailed(await service.complete('microsoft', query, binding), 'provider_error');
  });
});

describe('SsoService.sweep', () => {
  it('deletes used requests and requests expired more than an hour ago', async () => {
    const repo = ds.getRepository(SsoLoginRequest);
    const now = new Date('2026-01-01T12:00:00Z');
    const row = (state: string, expiresAt: Date, usedAt: Date | null = null) =>
      repo.create({ state, provider: 'microsoft', nonce: 'n', codeVerifier: 'v', bindingHash: 'h', returnTo: '/', expiresAt, usedAt });
    await repo.save([
      row('fresh', new Date('2026-01-01T12:05:00Z')),
      row('used', new Date('2026-01-01T12:05:00Z'), new Date('2026-01-01T11:59:00Z')),
      row('expired-recently', new Date('2026-01-01T11:30:00Z')),
      row('expired-2h', new Date('2026-01-01T10:00:00Z')),
    ]);
    assert.equal(await service.sweep(now), 2);
    assert.deepEqual((await repo.find({ order: { state: 'ASC' } })).map((r) => r.state), ['expired-recently', 'fresh']);
  });
});
