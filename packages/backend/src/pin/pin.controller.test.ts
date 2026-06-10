import { describe, it, beforeEach, afterEach, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { NoteMeta } from '../entities/note-meta.entity';
import { PinService } from './pin.service';
import { PinController } from './pin.controller';
import type { EncryptionPredicates } from '../crypto/encryption-predicates';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ALICE_NOTE = '_users/alice@example.com/foo.md';
const ALICE_E2E = '_users/alice@example.com/_secure/journal.md';

let ds: DataSource;
let repo: Repository<NoteMeta>;
let svc: PinService;
let ctrl: PinController;

const stagePredicates = (e2e: (path: string) => boolean): EncryptionPredicates => ({
  isEncryptedAtRest: () => false,
  isE2EEncrypted: e2e,
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
});

before(() => {
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
  ctrl = new PinController(
    svc,
    stagePredicates((path: string) => path.includes('/_secure/')),
  );
});

afterEach(async () => {
  await ds.destroy();
});

function userReq(email: string) {
  return { user: { email, sub: 1 } } as any;
}

function fakeRes() {
  const cookies: Record<string, { value: string; opts: any }> = {};
  return {
    cookies,
    cookie: (name: string, value: string, opts: any) => {
      cookies[name] = { value, opts };
    },
  } as any;
}

describe('PinController — Stage-2 carve-out (task 7.10)', () => {
  it('rejects POST /pin for an E2E path with 400', async () => {
    await assert.rejects(
      ctrl.setPin(ALICE_E2E, { pin: 'abcd1234' }, userReq(ALICE)),
      (err: unknown) => {
        assert.equal((err as Error).name, 'BadRequestException');
        return true;
      },
    );
  });

  it('accepts POST /pin for a non-E2E path', async () => {
    await ctrl.setPin(ALICE_NOTE, { pin: 'abcd1234' }, userReq(ALICE));
    assert.equal(await svc.hasPin(ALICE_NOTE), true);
  });
});

describe('PinController — owner / grantee semantics (task 7.6)', () => {
  it('grantee cannot DELETE PIN — controller throws Forbidden', async () => {
    await ctrl.setPin(ALICE_NOTE, { pin: 'abcd1234' }, userReq(ALICE));
    await assert.rejects(
      ctrl.removePin(ALICE_NOTE, userReq(BOB)),
      (err: unknown) => {
        assert.equal((err as Error).name, 'ForbiddenException');
        return true;
      },
    );
  });

  it('owner can remove PIN without supplying it (task 7.5)', async () => {
    await ctrl.setPin(ALICE_NOTE, { pin: 'abcd1234' }, userReq(ALICE));
    await ctrl.removePin(ALICE_NOTE, userReq(ALICE));
    assert.equal(await svc.hasPin(ALICE_NOTE), false);
  });

  it('verify endpoint sets a session cookie with the unlock JWT', async () => {
    await ctrl.setPin(ALICE_NOTE, { pin: 'abcd1234' }, userReq(ALICE));
    const res = fakeRes();
    const result = await ctrl.verifyPin(ALICE_NOTE, { pin: 'abcd1234' }, userReq(ALICE), res);
    assert.equal((result as { ok?: boolean }).ok, true);
    const cookieNames = Object.keys((res as any).cookies);
    assert.equal(cookieNames.length, 1);
    assert.match(cookieNames[0], /^kalepin_pin_unlock_/);
    const cookie = (res as any).cookies[cookieNames[0]];
    assert.ok(cookie.value, 'cookie holds the JWT');
    assert.equal(cookie.opts.httpOnly, true);
    assert.equal(cookie.opts.sameSite, 'lax');
  });

  it('one-shot verify returns the token in the body and does NOT set a cookie', async () => {
    await ctrl.setPin(ALICE_NOTE, { pin: 'abcd1234' }, userReq(ALICE));
    const res = fakeRes();
    const result = await ctrl.verifyPin(
      ALICE_NOTE,
      { pin: 'abcd1234', oneShot: true },
      userReq(ALICE),
      res,
    );
    assert.ok((result as { token?: string }).token, 'token returned in body');
    assert.equal(Object.keys((res as any).cookies).length, 0);
  });

  it('rejects invalid path traversal', async () => {
    await assert.rejects(
      ctrl.setPin('../etc/passwd', { pin: 'abcd1234' }, userReq(ALICE)),
      { name: 'BadRequestException' },
    );
  });
});
