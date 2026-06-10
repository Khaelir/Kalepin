import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { ShortLink } from '../entities/short-link.entity';
import { ShareLinksService } from './share-links.service';
import type { StorageAdapter } from '../storage';

// Minimal StorageAdapter mock — only `exists` is used by the service
function mockStorage(existingFiles: Set<string>): StorageAdapter {
  return {
    exists: async (p: string) => existingFiles.has(p),
    read: async () => '',
    write: async () => {},
    delete: async () => {},
    move: async () => {},
    list: async () => [],
    watch: () => {},
  } as unknown as StorageAdapter;
}

let ds: DataSource;
let repo: Repository<ShortLink>;
let service: ShareLinksService;
const files = new Set<string>();

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [ShortLink],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(ShortLink);
  files.clear();
  files.add('notes/meeting.md');
  files.add('notes/design.md');
  files.add('projects/alpha/readme.md');
  service = new ShareLinksService(repo, mockStorage(files), {
    isEncryptedAtRest: () => false,
    isE2EEncrypted: () => false,
    shouldIndexPlaintext: () => true,
    canCollab: () => true,
    commentBodiesEncrypted: () => false,
    shareLinkMintable: () => true,
  } as any);
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

describe('ShareLinksService.mintExplicit', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('generates a 15-char HMAC-tagged code on first mint', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    assert.equal(typeof code, 'string');
    assert.equal(code.length, 15);
    assert.match(code, /^[0-9A-Za-z]{15}$/);
  });

  it('returns the same code on re-mint while active (idempotent)', async () => {
    const r1 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const r2 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    assert.equal(r1.code, r2.code);
  });

  it('persists ttl as expires_at = now + ttlMs', async () => {
    const before = Date.now();
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: 7 * 86400 * 1000,
      createdByEmail: 'alice@x.com',
    });
    const after = Date.now();
    const row = await repo.findOneOrFail({ where: { code } });
    assert.ok(row.expiresAt !== null);
    assert.ok(row.expiresAt! >= before + 7 * 86400 * 1000);
    assert.ok(row.expiresAt! <= after + 7 * 86400 * 1000);
  });

  it('persists null ttl as expires_at = null (never)', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const row = await repo.findOneOrFail({ where: { code } });
    assert.equal(row.expiresAt, null);
  });

  it('persists created_by_email', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const row = await repo.findOneOrFail({ where: { code } });
    assert.equal(row.createdByEmail, 'alice@x.com');
  });

  it('mints a NEW code when the existing row is expired', async () => {
    // Mint a row that is already expired (expires_at = 1)
    const r1 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await repo.update({ code: r1.code }, { expiresAt: 1 });
    const r2 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    assert.notEqual(r1.code, r2.code);
    // Old row still present, untouched
    const oldRow = await repo.findOneOrFail({ where: { code: r1.code } });
    assert.equal(oldRow.expiresAt, 1);
  });

  it('mints a NEW code when the existing row is revoked', async () => {
    const r1 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await service.revoke(r1.code);
    const r2 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    assert.notEqual(r1.code, r2.code);
  });

  it('throws for nonexistent file', async () => {
    await assert.rejects(
      () =>
        service.mintExplicit({
          path: 'notes/nonexistent.md',
          ttlMs: null,
          createdByEmail: 'alice@x.com',
        }),
      (err: Error) => err.message.includes('File not found'),
    );
  });
});

describe('ShareLinksService.getOrCreate (legacy wrapper)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('mints a never-expiring row with null created_by_email', async () => {
    const code = await service.getOrCreate('notes/meeting.md');
    const row = await repo.findOneOrFail({ where: { code } });
    assert.equal(row.expiresAt, null);
    assert.equal(row.createdByEmail, null);
  });

  it('is idempotent', async () => {
    const a = await service.getOrCreate('notes/meeting.md');
    const b = await service.getOrCreate('notes/meeting.md');
    assert.equal(a, b);
  });
});

describe('ShareLinksService.revoke', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('sets revoked_at on the row', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const before = Date.now();
    await service.revoke(code);
    const after = Date.now();
    const row = await repo.findOneOrFail({ where: { code } });
    assert.ok(row.revokedAt !== null);
    assert.ok(row.revokedAt! >= before);
    assert.ok(row.revokedAt! <= after);
  });

  it('is a no-op for unknown codes', async () => {
    await service.revoke('zzzzzzzzzz');
    // Did not throw
  });

  it('does not overwrite revokedAt on a second call', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await service.revoke(code);
    const first = (await repo.findOneOrFail({ where: { code } })).revokedAt;
    await new Promise((r) => setTimeout(r, 5));
    await service.revoke(code);
    const second = (await repo.findOneOrFail({ where: { code } })).revokedAt;
    assert.equal(first, second);
  });
});

describe('ShareLinksService.findByPath', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns null for a path with no row', async () => {
    const info = await service.findByPath('notes/no-such.md');
    assert.equal(info, null);
  });

  it('returns the active row metadata', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: 30 * 86400 * 1000,
      createdByEmail: 'alice@x.com',
    });
    const info = await service.findByPath('notes/meeting.md');
    assert.ok(info);
    assert.equal(info!.code, code);
    assert.ok(info!.expires_at !== null);
    assert.equal(info!.revoked_at, null);
    assert.equal(info!.last_resolved_at, null);
    assert.ok(info!.created_at > 0);
  });

  it('prefers an active row over an older expired row', async () => {
    const r1 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await repo.update({ code: r1.code }, { expiresAt: 1 });
    const r2 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const info = await service.findByPath('notes/meeting.md');
    assert.equal(info!.code, r2.code);
  });

  it('returns the most recent revoked row when no active exists', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await service.revoke(code);
    const info = await service.findByPath('notes/meeting.md');
    assert.equal(info!.code, code);
    assert.ok(info!.revoked_at !== null);
  });
});

describe('ShareLinksService.resolve', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('resolves a valid code to its path', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const result = await service.resolve(code);
    assert.deepEqual(result, { kind: 'ok', path: 'notes/meeting.md' });
  });

  it('returns not_found for unknown code', async () => {
    const result = await service.resolve('zzzzzzzzzz');
    assert.deepEqual(result, { kind: 'not_found' });
  });

  it('returns gone:revoked for a revoked code', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await service.revoke(code);
    const result = await service.resolve(code);
    assert.deepEqual(result, { kind: 'gone', reason: 'revoked' });
  });

  it('returns gone:expired for an expired code', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await repo.update({ code }, { expiresAt: 1 });
    const result = await service.resolve(code);
    assert.deepEqual(result, { kind: 'gone', reason: 'expired' });
  });
});

describe('ShareLinksService.updatePath', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('updates path on rename — code still resolves', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await service.updatePath('notes/meeting.md', 'notes/standup.md');
    const result = await service.resolve(code);
    assert.deepEqual(result, { kind: 'ok', path: 'notes/standup.md' });
  });

  it('handles rename of file without share link (no-op)', async () => {
    await service.updatePath('notes/nonexistent.md', 'notes/other.md');
    // Should not throw
  });
});

describe('ShareLinksService.updatePathPrefix (folder rename)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('updates all child paths on folder rename', async () => {
    const r1 = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    const r2 = await service.mintExplicit({
      path: 'notes/design.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });

    await service.updatePathPrefix('notes', 'archive');

    assert.deepEqual(await service.resolve(r1.code), {
      kind: 'ok',
      path: 'archive/meeting.md',
    });
    assert.deepEqual(await service.resolve(r2.code), {
      kind: 'ok',
      path: 'archive/design.md',
    });
  });

  it('does not affect paths outside the prefix', async () => {
    const { code } = await service.mintExplicit({
      path: 'projects/alpha/readme.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await service.updatePathPrefix('notes', 'archive');
    assert.deepEqual(await service.resolve(code), {
      kind: 'ok',
      path: 'projects/alpha/readme.md',
    });
  });
});

describe('ShareLinksService.deleteByPath', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('removes the share link — code returns not_found', async () => {
    const { code } = await service.mintExplicit({
      path: 'notes/meeting.md',
      ttlMs: null,
      createdByEmail: 'alice@x.com',
    });
    await service.deleteByPath('notes/meeting.md');
    const result = await service.resolve(code);
    assert.deepEqual(result, { kind: 'not_found' });
  });

  it('handles delete of file without share link (no-op)', async () => {
    await service.deleteByPath('notes/nonexistent.md');
    // Should not throw
  });
});
