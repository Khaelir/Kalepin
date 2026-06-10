import { describe, it, beforeEach, afterEach, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { NoteMeta } from '../entities/note-meta.entity';
import {
  PinService,
  PinLockedException,
  pinCookieName,
  RATE_LIMIT_MAX_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} from './pin.service';

let ds: DataSource;
let repo: Repository<NoteMeta>;
let svc: PinService;

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const NOTE = '_users/alice@example.com/foo.md';
const E2E_NOTE = '_users/alice@example.com/_secure/journal.md';
const PIN = 'abcd1234';
const WRONG_PIN = 'wrong123';

before(() => {
  // Deterministic JWT secret across test runs.
  process.env.JWT_SECRET = 'test-secret';
});

beforeEach(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [NoteMeta],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(NoteMeta);
  svc = new PinService(repo);
});

afterEach(async () => {
  await ds.destroy();
});

describe('PinService — set / verify / remove', () => {
  it('7.1 Owner sets PIN; reads without verify return locked=true', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    assert.equal(await svc.hasPin(NOTE), true);
    const locked = await svc.isLocked(NOTE, ALICE, null);
    assert.equal(locked, true);
  });

  it('7.2 Verify with correct PIN issues unlock token; subsequent reads succeed', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    const verify = await svc.verifyPin(NOTE, PIN, ALICE, 'owner');
    assert.equal(verify.ok, true);
    assert.ok(verify.token);
    const locked = await svc.isLocked(NOTE, ALICE, verify.token!);
    assert.equal(locked, false);
  });

  it('7.5 Owner reset (DELETE) without PIN clears state', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    await svc.removePin(NOTE);
    assert.equal(await svc.hasPin(NOTE), false);
    assert.equal(await svc.isLocked(NOTE, ALICE, null), false);
  });

  it('7.7 Tampered cookie (wrong path in JWT) returns locked', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    await svc.setPin('_users/alice@example.com/other.md', PIN, ALICE);
    const verify = await svc.verifyPin('_users/alice@example.com/other.md', PIN, ALICE, 'owner');
    assert.ok(verify.token);
    // Token is for `other.md`; using it on NOTE must fail.
    const locked = await svc.isLocked(NOTE, ALICE, verify.token!);
    assert.equal(locked, true);
  });

  it('Token from another viewer fails sub check', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    const verify = await svc.verifyPin(NOTE, PIN, BOB, 'grantee');
    const locked = await svc.isLocked(NOTE, ALICE, verify.token!);
    assert.equal(locked, true, 'token issued for Bob must not unlock for Alice');
  });

  it('cookie name is per-path (different hashes for different paths)', () => {
    const a = pinCookieName('_users/alice@example.com/foo.md');
    const b = pinCookieName('_users/alice@example.com/bar.md');
    assert.notEqual(a, b);
    assert.match(a, /^kalepin_pin_unlock_[a-f0-9]{16}$/);
  });
});

describe('PinService — rate limit + lockout', () => {
  it('7.3 5 wrong attempts trigger 15-min lockout', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    let lastResult;
    for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
      lastResult = await svc.verifyPin(NOTE, WRONG_PIN, ALICE, 'owner');
    }
    assert.equal(lastResult!.ok, false);
    assert.ok(lastResult!.lockoutUntil, 'lockout must be set on the 5th wrong attempt');
    assert.ok(lastResult!.lockoutUntil! > Date.now());
    assert.ok(lastResult!.lockoutUntil! <= Date.now() + LOCKOUT_DURATION_MS + 100);
  });

  it('remaining attempts decrement on each wrong PIN', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    const r1 = await svc.verifyPin(NOTE, WRONG_PIN, ALICE, 'owner');
    assert.equal(r1.remainingAttempts, RATE_LIMIT_MAX_ATTEMPTS - 1);
    const r2 = await svc.verifyPin(NOTE, WRONG_PIN, ALICE, 'owner');
    assert.equal(r2.remainingAttempts, RATE_LIMIT_MAX_ATTEMPTS - 2);
  });

  it('7.4 Verify during lockout returns lockoutUntil; after lockout expires, attempts reset', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await svc.verifyPin(NOTE, WRONG_PIN, ALICE, 'owner');
    }
    const duringLockout = await svc.verifyPin(NOTE, PIN, ALICE, 'owner');
    assert.equal(duringLockout.ok, false);
    assert.ok(duringLockout.lockoutUntil, 'lockout still in effect');

    // Force-expire the in-memory lockout for (path, user:alice) and confirm
    // the next attempt resets the counter and lets a correct PIN through.
    svc._expireLockoutForTest(NOTE, `user:${ALICE}`);
    const after = await svc.verifyPin(NOTE, PIN, ALICE, 'owner');
    assert.equal(after.ok, true, 'expired lockout must allow fresh attempts');
    assert.ok(after.token);
  });

  it('per-identifier buckets: a guest IP locked out does not block the owner', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    // Guest from IP 1.2.3.4 burns 5 wrong attempts → lockout for that IP.
    for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await svc.verifyPin(NOTE, WRONG_PIN, 'anonymous-X', 'share-viewer', 'ip:1.2.3.4');
    }
    const guestLocked = await svc.verifyPin(NOTE, PIN, 'anonymous-X', 'share-viewer', 'ip:1.2.3.4');
    assert.ok(guestLocked.lockoutUntil, 'guest IP must be locked');
    // Owner attempt succeeds because their bucket (`user:alice@…`) is independent.
    const owner = await svc.verifyPin(NOTE, PIN, ALICE, 'owner');
    assert.equal(owner.ok, true, 'owner must not be locked out by a guest IP');
    // A different guest IP also still has its full budget.
    const r = await svc.verifyPin(NOTE, WRONG_PIN, 'anonymous-X', 'share-viewer', 'ip:5.6.7.8');
    assert.equal(r.remainingAttempts, RATE_LIMIT_MAX_ATTEMPTS - 1);
  });

  it('correct PIN clears the failed-attempts counter', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    await svc.verifyPin(NOTE, WRONG_PIN, ALICE, 'owner');
    await svc.verifyPin(NOTE, WRONG_PIN, ALICE, 'owner');
    await svc.verifyPin(NOTE, PIN, ALICE, 'owner');

    // After a success the next wrong attempt sees a full window's allowance.
    const r = await svc.verifyPin(NOTE, WRONG_PIN, ALICE, 'owner');
    assert.equal(r.remainingAttempts, RATE_LIMIT_MAX_ATTEMPTS - 1);
  });
});

describe('PinService — grantee + share-viewer + one-shot', () => {
  it('7.6 grantee can verify and unlock', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    const verify = await svc.verifyPin(NOTE, PIN, BOB, 'grantee');
    assert.equal(verify.ok, true);
    const locked = await svc.isLocked(NOTE, BOB, verify.token!);
    assert.equal(locked, false);
  });

  it('one-shot token validates against header path + viewer', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    const verify = await svc.verifyPin(NOTE, PIN, ALICE, 'one-shot');
    assert.equal(verify.ok, true);
    const payload = svc.validateUnlockToken(verify.token!, NOTE, ALICE);
    assert.ok(payload);
    assert.equal(payload!.kind, 'one-shot');
  });

  it('share-viewer token isolates by synthetic anonymous-<code> sub', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    const anonViewer = 'anonymous-ABC123';
    const verify = await svc.verifyPin(NOTE, PIN, anonViewer, 'share-viewer');
    const payload = svc.validateUnlockToken(verify.token!, NOTE, anonViewer);
    assert.ok(payload);
    // A different viewer cannot reuse the share-viewer token.
    const replay = svc.validateUnlockToken(verify.token!, NOTE, ALICE);
    assert.equal(replay, null);
  });
});

describe('PinService — input validation', () => {
  it('rejects PIN shorter than 8 chars or containing whitespace', async () => {
    await assert.rejects(svc.setPin(NOTE, '1234', ALICE), { name: 'BadRequestException' });
    await assert.rejects(svc.setPin(NOTE, 'abc 5678', ALICE), { name: 'BadRequestException' });
  });

  it('accepts a long passphrase with mixed characters', async () => {
    await svc.setPin(NOTE, 'correct-horse-battery-staple!42', ALICE);
    const r = await svc.verifyPin(NOTE, 'correct-horse-battery-staple!42', ALICE, 'owner');
    assert.equal(r.ok, true);
  });

  it('verifyPin throws when no PIN is set', async () => {
    await assert.rejects(svc.verifyPin(NOTE, PIN, ALICE, 'owner'), { name: 'BadRequestException' });
  });

  it('assertUnlocked throws PinLockedException with status 423', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    await assert.rejects(svc.assertUnlocked(NOTE, ALICE, null, null), (err: unknown) => {
      assert.ok(err instanceof PinLockedException);
      assert.equal((err as PinLockedException).getStatus(), 423);
      return true;
    });
  });

  it('listLockedFor returns only the owner\'s notes', async () => {
    await svc.setPin('_users/alice@example.com/a.md', PIN, ALICE);
    await svc.setPin('_users/alice@example.com/b.md', PIN, ALICE);
    await svc.setPin('_users/bob@example.com/c.md', PIN, BOB);
    const aliceList = await svc.listLockedFor(ALICE);
    assert.deepEqual(
      aliceList.map((i) => i.path).sort(),
      ['_users/alice@example.com/a.md', '_users/alice@example.com/b.md'],
    );
  });

  it('PIN cookie helper produces expected suffix length', () => {
    void E2E_NOTE; // referenced in controller-level test below
    assert.match(pinCookieName(NOTE), /^kalepin_pin_unlock_[a-f0-9]{16}$/);
  });
});

describe('PinService — assertUnlockedForRequest (cookie + header)', () => {
  it('7.8 share-viewer cookie unlocks via cookie header (session-scoped at HTTP layer)', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    const anon = 'anonymous-CODE1';
    const verify = await svc.verifyPin(NOTE, PIN, anon, 'share-viewer');
    const cookieName = pinCookieName(NOTE);
    const req = {
      headers: {
        cookie: `${cookieName}=${verify.token}`,
      },
    };
    // Should not throw — token validates for the synthetic viewer.
    await svc.assertUnlockedForRequest(req as any, NOTE, anon);
  });

  it('7.9 X-Kalepin-Unlock header unlocks for matching path/viewer (one-shot)', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    const verify = await svc.verifyPin(NOTE, PIN, ALICE, 'one-shot');
    const req = {
      headers: { 'x-kalepin-unlock': verify.token! },
    };
    await svc.assertUnlockedForRequest(req as any, NOTE, ALICE);
  });

  it('header token for wrong path is rejected', async () => {
    await svc.setPin(NOTE, PIN, ALICE);
    await svc.setPin('_users/alice@example.com/other.md', PIN, ALICE);
    const otherToken = (await svc.verifyPin(
      '_users/alice@example.com/other.md', PIN, ALICE, 'one-shot',
    )).token!;
    const req = {
      headers: { 'x-kalepin-unlock': otherToken },
    };
    await assert.rejects(svc.assertUnlockedForRequest(req as any, NOTE, ALICE), {
      name: 'PinLockedException',
    });
  });
});
