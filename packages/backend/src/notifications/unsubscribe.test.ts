import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { resolveJwtSecret } from '../auth/jwt-secret';
import { mintUnsubscribeToken, verifyUnsubscribeToken, UNSUBSCRIBE_PURPOSE } from './unsubscribe-token';
import { UnsubscribeController } from './unsubscribe.controller';
import {
  NotificationPreferencesService,
  preferenceAllows,
  isEmailPreference,
} from './notification-preferences.service';

const SECRET = 'test-secret';
const BOB = 'bob@example.com';

describe('unsubscribe token', () => {
  it('round-trips the canonical recipient', () => {
    const token = mintUnsubscribeToken('Bob@Example.com', SECRET);
    assert.equal(verifyUnsubscribeToken(token, SECRET), BOB);
  });

  it('carries a purpose claim and no email claim', () => {
    const decoded = jwt.decode(mintUnsubscribeToken(BOB, SECRET)) as Record<string, unknown>;
    assert.equal(decoded.purpose, UNSUBSCRIBE_PURPOSE);
    assert.equal(decoded.sub, BOB);
    assert.equal('email' in decoded, false);
    assert.ok(typeof decoded.exp === 'number');
  });

  it('rejects a token with another purpose', () => {
    const other = jwt.sign({ sub: BOB, purpose: 'pin-unlock' }, SECRET);
    assert.equal(verifyUnsubscribeToken(other, SECRET), null);
  });

  it('rejects a session JWT', () => {
    const session = jwt.sign({ sub: 1, email: BOB }, SECRET);
    assert.equal(verifyUnsubscribeToken(session, SECRET), null);
  });

  it('rejects a PIN unlock token (same secret, sub is an email)', () => {
    const pin = jwt.sign({ sub: BOB, path: 'Notes/x.md', kind: 'owner' }, SECRET);
    assert.equal(verifyUnsubscribeToken(pin, SECRET), null);
  });

  it('rejects a tampered payload', () => {
    const [h, , s] = mintUnsubscribeToken(BOB, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'carol@example.com', purpose: UNSUBSCRIBE_PURPOSE }))
      .toString('base64url');
    assert.equal(verifyUnsubscribeToken(`${h}.${forged}.${s}`, SECRET), null);
  });

  it('rejects a tampered signature and a foreign secret', () => {
    const token = mintUnsubscribeToken(BOB, SECRET);
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    assert.equal(verifyUnsubscribeToken(flipped, SECRET), null);
    assert.equal(verifyUnsubscribeToken(mintUnsubscribeToken(BOB, 'other-secret'), SECRET), null);
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { sub: BOB, purpose: UNSUBSCRIBE_PURPOSE, exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET,
    );
    assert.equal(verifyUnsubscribeToken(expired, SECRET), null);
  });

  it('rejects non-strings and malformed subjects', () => {
    assert.equal(verifyUnsubscribeToken(undefined, SECRET), null);
    assert.equal(verifyUnsubscribeToken(['x'], SECRET), null);
    assert.equal(verifyUnsubscribeToken('', SECRET), null);
    const badSub = jwt.sign({ sub: 'not an email', purpose: UNSUBSCRIBE_PURPOSE }, SECRET);
    assert.equal(verifyUnsubscribeToken(badSub, SECRET), null);
  });

  it('is never accepted as a session credential', () => {
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = SECRET;
    try {
      const auth = new AuthService({} as any, {} as any, {} as any);
      assert.throws(() => auth.verifyToken(mintUnsubscribeToken(BOB, SECRET)), UnauthorizedException);
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prev;
    }
  });
});

describe('email preference rules', () => {
  it('maps preference × kind', () => {
    assert.equal(preferenceAllows('all', 'reply'), true);
    assert.equal(preferenceAllows('all', 'mention'), true);
    assert.equal(preferenceAllows('mentions', 'mention'), true);
    assert.equal(preferenceAllows('mentions', 'share'), true);
    assert.equal(preferenceAllows('mentions', 'reply'), false);
    assert.equal(preferenceAllows('none', 'mention'), false);
    assert.equal(preferenceAllows('none', 'share'), false);
  });

  it('validates values', () => {
    assert.equal(isEmailPreference('all'), true);
    assert.equal(isEmailPreference('mentions'), true);
    assert.equal(isEmailPreference('none'), true);
    assert.equal(isEmailPreference('sometimes'), false);
    assert.equal(isEmailPreference(undefined), false);
  });
});

describe('NotificationPreferencesService + UnsubscribeController', () => {
  let ds: DataSource;
  let prefs: NotificationPreferencesService;
  let controller: UnsubscribeController;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User], synchronize: true });
    await ds.initialize();
    await ds.getRepository(User).save({ email: BOB });
    prefs = new NotificationPreferencesService(ds.getRepository(User));
    controller = new UnsubscribeController(prefs);
  });

  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('defaults to all, including for unknown users', async () => {
    assert.equal(await prefs.get(BOB), 'all');
    assert.equal(await prefs.get('nobody@example.com'), 'all');
  });

  it('persists a new preference', async () => {
    assert.equal(await prefs.set(BOB, 'mentions'), true);
    assert.equal(await prefs.get(BOB), 'mentions');
    assert.equal(await prefs.allowsEmail(BOB, 'reply'), false);
    assert.equal(await prefs.allowsEmail(BOB, 'mention'), true);
    assert.equal(await prefs.set('nobody@example.com', 'none'), false);
  });

  it('a valid link turns emails off and renders a confirmation page', async () => {
    const outcome = await controller.unsubscribe(mintUnsubscribeToken(BOB));
    assert.equal(outcome.status, 200);
    assert.match(outcome.html, /You are unsubscribed/);
    assert.match(outcome.html, /bob@example\.com/);
    assert.equal(await prefs.get(BOB), 'none');
  });

  it('an invalid link changes nothing', async () => {
    await prefs.set(BOB, 'mentions');
    for (const bad of [undefined, 'garbage', jwt.sign({ sub: BOB, purpose: 'other' }, resolveJwtSecret())]) {
      const outcome = await controller.unsubscribe(bad);
      assert.equal(outcome.status, 400);
      assert.match(outcome.html, /invalid or has expired/);
    }
    assert.equal(await prefs.get(BOB), 'mentions');
  });

  it('serves GET and POST through the same flow', async () => {
    const calls: { status: number; type: string; body: string }[] = [];
    const res: any = {
      status(code: number) { calls.push({ status: code, type: '', body: '' }); return this; },
      type(t: string) { calls[calls.length - 1].type = t; return this; },
      send(b: string) { calls[calls.length - 1].body = b; return this; },
    };
    await controller.unsubscribePage(mintUnsubscribeToken(BOB), res);
    await controller.unsubscribeOneClick('nope', res);
    assert.equal(calls[0].status, 200);
    assert.equal(calls[0].type, 'html');
    assert.equal(calls[1].status, 400);
  });
});
