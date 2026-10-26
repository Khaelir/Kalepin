import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { resolveAccount, emailCandidates, displayNameToFill } from './account-linking';
import { recordIdentity } from './user-identities';
import { User } from '../../entities/user.entity';
import { UserIdentity } from '../../entities/user-identity.entity';

const ALL = ['*'];
const COMPANY = ['company.com'];
const alice = { id: 1, email: 'alice@company.com' };
const bob = { id: 2, email: 'bob@company.com' };

describe('emailCandidates', () => {
  it('canonicalises, drops non-emails, filters the allowlist and dedupes in order', () => {
    assert.deepEqual(
      emailCandidates([' Alice@Company.COM ', 'not-an-email', 'alice@company.com', 'a@other.com', 'b@company.com'], COMPANY),
      ['alice@company.com', 'b@company.com'],
    );
  });
});

describe('resolveAccount', () => {
  it('signs in the user matched by the email claim', () => {
    assert.deepEqual(resolveAccount(['alice@company.com', 'alice@company.com'], ALL, [alice]), { outcome: 'existing', user: alice });
  });

  it('signs in the user matched by preferred_username only', () => {
    assert.deepEqual(resolveAccount(['a.smith@company.com', 'alice@company.com'], ALL, [alice]), {
      outcome: 'existing',
      user: alice,
    });
  });

  it('creates with the email claim first', () => {
    assert.deepEqual(resolveAccount(['new@company.com', 'upn@company.com'], ALL, []), { outcome: 'create', email: 'new@company.com' });
  });

  it('creates with preferred_username when the email claim is absent or unusable', () => {
    assert.deepEqual(resolveAccount(['upn@company.com'], ALL, []), { outcome: 'create', email: 'upn@company.com' });
    assert.deepEqual(resolveAccount(['x@other.com', 'upn@company.com'], COMPANY, []), { outcome: 'create', email: 'upn@company.com' });
  });

  it('refuses when the candidates match two different users', () => {
    assert.deepEqual(resolveAccount(['bob@company.com', 'alice@company.com'], ALL, [bob, alice]), {
      outcome: 'ambiguous',
      userIds: [1, 2],
    });
  });

  it('ignores a non-email preferred_username', () => {
    assert.deepEqual(resolveAccount(['alice@company.com', 'ALICE\\corp'], ALL, [alice]), { outcome: 'existing', user: alice });
  });

  it('canonicalises case and whitespace', () => {
    assert.deepEqual(resolveAccount([' Alice@Company.COM '], ALL, [alice]), { outcome: 'existing', user: alice });
  });

  it('refuses when nothing is allowlisted', () => {
    assert.deepEqual(resolveAccount(['alice@other.com', 'alice@other.org'], COMPANY, []), { outcome: 'domain_not_allowed' });
    assert.deepEqual(resolveAccount([], ALL, []), { outcome: 'domain_not_allowed' });
    assert.deepEqual(resolveAccount(['not-an-email'], ALL, []), { outcome: 'domain_not_allowed' });
  });

  it('does not match a user through a non-allowlisted candidate', () => {
    const outsider = { id: 3, email: 'alice@other.com' };
    assert.deepEqual(resolveAccount(['alice@other.com', 'alice@company.com'], COMPANY, [outsider]), {
      outcome: 'create',
      email: 'alice@company.com',
    });
  });

  it('counts a user returned twice once', () => {
    assert.deepEqual(resolveAccount(['alice@company.com'], ALL, [alice, { ...alice }]), { outcome: 'existing', user: alice });
  });
});

describe('displayNameToFill', () => {
  it('fills an empty display name', () => {
    assert.equal(displayNameToFill(undefined, 'Alice Smith'), 'Alice Smith');
    assert.equal(displayNameToFill(null, ' Alice Smith '), 'Alice Smith');
    assert.equal(displayNameToFill('', 'Alice Smith'), 'Alice Smith');
    assert.equal(displayNameToFill('  ', 'Alice Smith'), 'Alice Smith');
  });

  it('keeps an existing display name', () => {
    assert.equal(displayNameToFill('Ali', 'Alice Smith'), null);
  });

  it('ignores an empty provider name', () => {
    assert.equal(displayNameToFill(undefined, undefined), null);
    assert.equal(displayNameToFill(undefined, '   '), null);
  });

  it('limits the name to 200 characters without splitting a code point', () => {
    assert.equal(displayNameToFill(undefined, 'a'.repeat(250)), 'a'.repeat(200));
    const emoji = '😀'.repeat(250);
    assert.equal(displayNameToFill(undefined, emoji), '😀'.repeat(200));
  });
});

describe('recordIdentity', () => {
  let ds: DataSource;
  let repo: Repository<UserIdentity>;
  let logs: { level: string; message: string }[];
  const logger = {
    log: (message: string) => logs.push({ level: 'log', message }),
    warn: (message: string) => logs.push({ level: 'warn', message }),
  };
  const identity = { issuer: 'https://login.example/t/v2.0', subject: 'oid-x', emails: [] };

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User, UserIdentity], synchronize: true });
    await ds.initialize();
    await ds.getRepository(User).save([
      { email: 'alice@company.com' },
      { email: 'bob@company.com' },
    ]);
    repo = ds.getRepository(UserIdentity);
    logs = [];
  });

  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('inserts the identity on first sign-in', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    await recordIdentity(repo, { provider: 'microsoft', identity, userId: 1, email: 'alice@company.com', now }, logger);
    const rows = await repo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 1);
    assert.equal(rows[0].emailAtLink, 'alice@company.com');
    assert.equal(rows[0].lastLoginAt.toISOString(), now.toISOString());
    assert.deepEqual(logs, []);
  });

  it('only bumps lastLoginAt on a repeat sign-in', async () => {
    await recordIdentity(repo, { provider: 'microsoft', identity, userId: 1, email: 'alice@company.com', now: new Date(1000) }, logger);
    const later = new Date('2026-02-01T00:00:00Z');
    await recordIdentity(repo, { provider: 'microsoft', identity, userId: 1, email: 'alice@company.com', now: later }, logger);
    const rows = await repo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lastLoginAt.toISOString(), later.toISOString());
    assert.deepEqual(logs, []);
  });

  it('re-points the identity to a new user with a warning', async () => {
    await recordIdentity(repo, { provider: 'microsoft', identity, userId: 1, email: 'alice@company.com' }, logger);
    await recordIdentity(repo, { provider: 'microsoft', identity, userId: 2, email: 'bob@company.com' }, logger);
    const rows = await repo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 2);
    assert.equal(rows[0].emailAtLink, 'bob@company.com');
    assert.deepEqual(logs, [{ level: 'warn', message: 'SSO identity microsoft/oid-x moved from user 1 to user 2' }]);
  });

  it('keeps several identities per user and logs a new one', async () => {
    await recordIdentity(repo, { provider: 'microsoft', identity, userId: 1, email: 'alice@company.com' }, logger);
    await recordIdentity(repo, { provider: 'microsoft', identity: { ...identity, subject: 'oid-y' }, userId: 1, email: 'alice@company.com' }, logger);
    assert.equal(await repo.count(), 2);
    assert.deepEqual(logs, [{ level: 'log', message: 'SSO user 1 signed in with a new microsoft identity oid-y' }]);
  });

  it('keys identities by issuer as well as subject', async () => {
    await recordIdentity(repo, { provider: 'microsoft', identity, userId: 1, email: 'alice@company.com' }, logger);
    await recordIdentity(repo, { provider: 'microsoft', identity: { ...identity, issuer: 'https://other/v2.0' }, userId: 2, email: 'bob@company.com' }, logger);
    assert.equal(await repo.count(), 2);
    assert.deepEqual(logs, []);
  });
});
