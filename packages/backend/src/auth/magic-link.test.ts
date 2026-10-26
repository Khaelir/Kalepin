import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { safeReturnPath } from './return-to';
import { MagicLinkToken } from '../entities/magic-link-token.entity';
import { User } from '../entities/user.entity';

const ORIG_ENV = { ...process.env };

let ds: DataSource;
let service: AuthService;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.DOMAIN_ALLOWLIST = '*';
  delete process.env.SMTP_USER;
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [MagicLinkToken, User],
    synchronize: true,
  });
  await ds.initialize();
  const apiKeyRepo = {} as any;
  service = new AuthService(ds.getRepository(User), ds.getRepository(MagicLinkToken), apiKeyRepo);
});

afterEach(async () => {
  if (ds?.isInitialized) await ds.destroy();
  process.env = { ...ORIG_ENV };
});

describe('AuthService.verifyMagicLink', () => {
  it('does not consume a pending link when the token is missing or malformed', async () => {
    await service.requestMagicLink('victim@example.com');
    for (const token of [undefined, null, '', 'not-a-uuid', ['x'], { $ne: '' }]) {
      await assert.rejects(
        () => service.verifyMagicLink(token),
        (err: unknown) => err instanceof UnauthorizedException,
        `token=${JSON.stringify(token)}`,
      );
    }
    const row = await ds.getRepository(MagicLinkToken).findOneByOrFail({ email: 'victim@example.com' });
    assert.equal(row.used, false);
  });

  it('signs in with the emailed token', async () => {
    await service.requestMagicLink('alice@example.com');
    const row = await ds.getRepository(MagicLinkToken).findOneByOrFail({ email: 'alice@example.com' });
    const { sessionToken } = await service.verifyMagicLink(row.token);
    assert.equal(service.verifyToken(sessionToken).email, 'alice@example.com');
  });

  it('stores returnTo reduced to a same-origin path', async () => {
    await service.requestMagicLink('alice@example.com', '//evil.example/');
    await service.requestMagicLink('bob@example.com', '/doc/abc?x=1#h');
    const repo = ds.getRepository(MagicLinkToken);
    assert.equal((await repo.findOneByOrFail({ email: 'alice@example.com' })).returnTo, '/');
    assert.equal((await repo.findOneByOrFail({ email: 'bob@example.com' })).returnTo, '/doc/abc?x=1#h');
  });
});

describe('AuthService domain allowlist', () => {
  function serviceWithAllowlist(allowlist: string): AuthService {
    process.env.DOMAIN_ALLOWLIST = allowlist;
    return new AuthService(ds.getRepository(User), ds.getRepository(MagicLinkToken), {} as any);
  }

  it('matches a mixed-case, padded entry', async () => {
    await serviceWithAllowlist(' Company.com ').requestMagicLink('alice@company.com');
    assert.ok(await ds.getRepository(MagicLinkToken).findOneBy({ email: 'alice@company.com' }));
  });

  it('rejects other domains', async () => {
    await assert.rejects(
      () => serviceWithAllowlist('company.com').requestMagicLink('eve@other.com'),
      (err: unknown) => err instanceof BadRequestException,
    );
  });
});

describe('AuthService SSO helpers', () => {
  it('finds users by any of several emails', async () => {
    const alice = await service.createUser('alice@example.com');
    await service.createUser('bob@example.com');
    assert.deepEqual(await service.findUsersByEmails([]), []);
    const found = await service.findUsersByEmails(['carol@example.com', 'alice@example.com']);
    assert.deepEqual(found.map((u) => u.id), [alice.id]);
  });

  it('creates a user with the canonical email and returns the existing row on a repeat', async () => {
    const first = await service.createUser(' Alice@Example.com ');
    assert.equal(first.email, 'alice@example.com');
    const again = await service.createUser('alice@example.com');
    assert.equal(again.id, first.id);
    assert.equal(await ds.getRepository(User).count(), 1);
  });

  it('issues the same session JWT as the magic link', async () => {
    const user = await service.createUser('alice@example.com');
    const payload = service.verifyToken(service.issueSession(user));
    assert.equal(payload.sub, user.id);
    assert.equal(payload.email, 'alice@example.com');
  });
});

describe('safeReturnPath', () => {
  it('keeps same-origin paths', () => {
    assert.equal(safeReturnPath('/'), '/');
    assert.equal(safeReturnPath('/doc/abc'), '/doc/abc');
    assert.equal(safeReturnPath('/s/x?y=1#/oauth/consent?request_id=r'), '/s/x?y=1#/oauth/consent?request_id=r');
  });

  it('falls back to / for anything that could leave the origin', () => {
    for (const target of [
      undefined,
      '',
      'doc/abc',
      'https://evil.example/',
      '//evil.example/',
      '///evil.example/',
      '/\\evil.example/',
      '/.//evil.example/',
      '/\tevil',
      'javascript:alert(1)',
    ]) {
      assert.equal(safeReturnPath(target), '/', String(target));
    }
  });
});
