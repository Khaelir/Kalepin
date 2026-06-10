import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let routing: RoutingStorageAdapter;

const JWT_SECRET = 'test-secret';
const ORIG_ENV = { ...process.env };

function makeAuthService() {
  // Minimal stand-in for the TypeORM repos that the AuthService constructor expects.
  const tokenRepo = {
    saved: [] as any[],
    async save(rec: any) { this.saved.push({ ...rec }); return rec; },
    async findOne() { return null; },
  };
  const userRepo = {
    rows: new Map<string, { id: number; email: string }>(),
    async findOne({ where }: any) { return this.rows.get(where.email) ?? null; },
    async findOneBy({ email }: any) { return this.rows.get(email) ?? null; },
    async save({ email }: any) {
      const existing = this.rows.get(email);
      if (existing) return existing;
      const row = { id: this.rows.size + 1, email };
      this.rows.set(email, row);
      return row;
    },
  };
  const apiKeyRepo = { async save() {}, async find() { return []; }, async findOne() { return null; }, async delete() { return { affected: 0 }; } };

  return new AuthService(
    userRepo as any,
    tokenRepo as any,
    apiKeyRepo as any,
    undefined,
    routing,
  );
}

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-auth-test-'));
  sharedRoot = path.join(tmpRoot, 'vault');
  personalRoot = path.join(tmpRoot, 'personal');
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
  process.env = ORIG_ENV;
});

beforeEach(async () => {
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(personalRoot, { recursive: true });
  routing = new RoutingStorageAdapter(
    new LocalFSAdapter(sharedRoot),
    new LocalFSAdapter(personalRoot),
  );
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DOMAIN_ALLOWLIST = '*';
  delete process.env.SMTP_USER;
});

describe('AuthService canonicalization', () => {
  it('requestMagicLink rejects malformed email with BadRequestException', async () => {
    const service = makeAuthService();
    await assert.rejects(
      () => service.requestMagicLink('not-an-email'),
      (err: any) => err instanceof BadRequestException,
    );
  });

  it('requestMagicLink stores canonical email in the magic-link record', async () => {
    const service = makeAuthService();
    const tokenRepo = (service as any).tokenRepo;
    await service.requestMagicLink('Alice@Example.COM  ');
    assert.equal(tokenRepo.saved.length, 1);
    assert.equal(tokenRepo.saved[0].email, 'alice@example.com');
  });

  it('verifyToken normalizes a mixed-case email in the JWT payload', () => {
    const service = makeAuthService();
    const tok = jwt.sign({ sub: 1, email: 'NOT-CANON@X.com' } as any, JWT_SECRET);
    const payload = service.verifyToken(tok);
    assert.equal(payload.email, 'not-canon@x.com');
  });

  it('verifyToken rejects a JWT whose email cannot canonicalize (fail-closed)', () => {
    const service = makeAuthService();
    const bad = jwt.sign({ sub: 1, email: '../etc@x.com' } as any, JWT_SECRET);
    assert.throws(
      () => service.verifyToken(bad),
      (err: any) => err instanceof UnauthorizedException,
    );
  });

  it('verifyToken accepts canonical-email JWT and returns the payload as-is', () => {
    const service = makeAuthService();
    const good = jwt.sign({ sub: 1, email: 'alice@example.com' } as any, JWT_SECRET);
    const payload = service.verifyToken(good);
    assert.equal(payload.email, 'alice@example.com');
    assert.equal(payload.sub, 1);
  });

  it('verifyToken rejects entirely-invalid JWT', () => {
    const service = makeAuthService();
    assert.throws(
      () => service.verifyToken('not.a.jwt'),
      (err: any) => err instanceof UnauthorizedException,
    );
  });
});

describe('AuthService ensurePersonalFolder hook', () => {
  it('ensureUser creates personal/{email}/ on first call', async () => {
    const service = makeAuthService();
    await service.ensureUser({ sub: 1, email: 'alice@example.com' });
    const stat = await fs.stat(path.join(personalRoot, 'alice@example.com'));
    assert.equal(stat.isDirectory(), true);
  });

  it('ensureUser is idempotent across repeat logins', async () => {
    const service = makeAuthService();
    await service.ensureUser({ sub: 1, email: 'alice@example.com' });
    await service.ensureUser({ sub: 1, email: 'alice@example.com' });
    const stat = await fs.stat(path.join(personalRoot, 'alice@example.com'));
    assert.equal(stat.isDirectory(), true);
  });

  it('ensureUser preserves an existing personal-note inside the folder', async () => {
    const service = makeAuthService();
    await service.ensureUser({ sub: 1, email: 'alice@example.com' });
    await fs.writeFile(path.join(personalRoot, 'alice@example.com', 'keep.md'), 'preserved');
    await service.ensureUser({ sub: 1, email: 'alice@example.com' });
    const body = await fs.readFile(path.join(personalRoot, 'alice@example.com', 'keep.md'), 'utf-8');
    assert.equal(body, 'preserved');
  });

  it('AuthService without a routing adapter is a silent no-op (rollback mode)', async () => {
    // Same as makeAuthService but without `routing`.
    const userRepo = {
      rows: new Map<string, any>(),
      async findOneBy({ email }: any) { return this.rows.get(email) ?? null; },
      async save({ email }: any) { const r = { id: 1, email }; this.rows.set(email, r); return r; },
    };
    const tokenRepo = { async save() {}, async findOne() { return null; } };
    const apiKeyRepo = { async findOne() { return null; } };

    const service = new AuthService(userRepo as any, tokenRepo as any, apiKeyRepo as any, undefined, undefined);
    // Must not throw despite `storage` being undefined.
    await service.ensureUser({ sub: 1, email: 'alice@example.com' });
  });
});
