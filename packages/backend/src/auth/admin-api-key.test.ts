import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { CombinedAuthGuard } from './combined-auth.guard';
import { REQUIRED_SCOPE_KEY } from './required-scope.decorator';
import { User } from '../entities/user.entity';
import { MagicLinkToken } from '../entities/magic-link-token.entity';
import { ApiKey } from '../entities/api-key.entity';

// ADMIN_EMAILS was checked only when an admin key was created; a key made by
// a former admin kept backup download, restore and the encryption toggles.

const ORIG_ENV = { ...process.env };
const ALICE = 'alice@example.com';

let ds: DataSource;
let service: AuthService;
let userId: number;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret';
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [User, MagicLinkToken, ApiKey],
    synchronize: true,
  });
  await ds.initialize();
  service = new AuthService(ds.getRepository(User), ds.getRepository(MagicLinkToken), ds.getRepository(ApiKey));
  userId = (await ds.getRepository(User).save({ email: ALICE })).id;
});

afterEach(async () => {
  if (ds?.isInitialized) await ds.destroy();
  process.env = { ...ORIG_ENV };
});

function adminRoute(token: string): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(REQUIRED_SCOPE_KEY, 'admin:backup', handler);
  const req = { headers: { authorization: `Bearer ${token}` } };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => null }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

describe('admin-scoped API keys', () => {
  it('keep admin rights while the owner is in ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = ALICE;
    const { key } = await service.createApiKey(userId, 'backup', 'admin');
    assert.equal((await service.verifyApiKey(key)).scope, 'admin');
    assert.equal(await new CombinedAuthGuard(service, new Reflector()).canActivate(adminRoute(key)), true);
  });

  it('lose them once the owner is removed from ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = ALICE;
    const { key } = await service.createApiKey(userId, 'backup', 'admin');
    process.env.ADMIN_EMAILS = 'someone-else@example.com';

    assert.equal((await service.verifyApiKey(key)).scope, 'rw');
    await assert.rejects(
      new CombinedAuthGuard(service, new Reflector()).canActivate(adminRoute(key)),
      ForbiddenException,
    );
  });
});
