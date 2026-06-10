import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource, Repository } from 'typeorm';
import { NoteAccessLog } from '../entities/note-access-log.entity';
import { AccessLogService } from './access-log.service';
import { hashIp, resolveIpSalt } from './ip-salt';

let tmpDir: string;
let ds: DataSource;
let repo: Repository<NoteAccessLog>;
let svc: AccessLogService;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-log-'));
  // Force the salt resolver into a deterministic location for the suite.
  process.env.ACCESS_LOG_IP_SALT = 'a'.repeat(64);
});

after(() => {
  delete process.env.ACCESS_LOG_IP_SALT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [NoteAccessLog],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(NoteAccessLog);
  svc = new AccessLogService(repo);
});

afterEach(async () => {
  await ds.destroy();
});

describe('AccessLogService.record dedup', () => {
  it('writes the first row and dedups a rapid follow-up edit', async () => {
    const t0 = 1_000_000;
    const r1 = await svc.record('Notes/foo.md', 'alice@x.com', 'edit', '1.2.3.4', t0);
    const r2 = await svc.record('Notes/foo.md', 'alice@x.com', 'edit', '1.2.3.4', t0 + 5_000);
    assert.ok(r1, 'first edit should write');
    assert.equal(r2, null, 'second edit within 60s should dedup');
    const all = await repo.find();
    assert.equal(all.length, 1);
  });

  it('writes again once the 60s edit window has elapsed', async () => {
    const t0 = 1_000_000;
    await svc.record('Notes/foo.md', 'alice@x.com', 'edit', '1.2.3.4', t0);
    const r2 = await svc.record('Notes/foo.md', 'alice@x.com', 'edit', '1.2.3.4', t0 + 61_000);
    assert.ok(r2, 'edit after 60s should write again');
    const all = await repo.find();
    assert.equal(all.length, 2);
  });

  it('uses a 5-minute window for view dedup', async () => {
    const t0 = 1_000_000;
    await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0);
    const dedupedAt4Min = await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0 + 4 * 60_000);
    const writtenAt6Min = await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0 + 6 * 60_000);
    assert.equal(dedupedAt4Min, null);
    assert.ok(writtenAt6Min);
  });

  it('separates dedup keys by action so an edit does not suppress a view', async () => {
    const t0 = 1_000_000;
    const r1 = await svc.record('Notes/foo.md', 'alice@x.com', 'edit', null, t0);
    const r2 = await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0 + 1_000);
    assert.ok(r1);
    assert.ok(r2, 'view after edit should still write');
  });

  it('separates dedup keys by viewer', async () => {
    const t0 = 1_000_000;
    await svc.record('Notes/foo.md', 'alice@x.com', 'edit', null, t0);
    const bobRow = await svc.record('Notes/foo.md', 'bob@x.com', 'edit', null, t0 + 1_000);
    assert.ok(bobRow, "bob's edit should not be deduped against alice's");
  });
});

describe('AccessLogService IP hashing', () => {
  it('hashes the same IP to the same value with the same salt', () => {
    const salt = Buffer.from('cafebabe'.repeat(8), 'hex');
    const a = hashIp(salt, '203.0.113.4');
    const b = hashIp(salt, '203.0.113.4');
    assert.equal(a, b);
    assert.match(a!, /^[0-9a-f]{16}$/);
  });

  it('produces different hashes for different IPs under one salt', () => {
    const salt = Buffer.from('cafebabe'.repeat(8), 'hex');
    const a = hashIp(salt, '203.0.113.4');
    const b = hashIp(salt, '203.0.113.5');
    assert.notEqual(a, b);
  });

  it('produces different hashes for the same IP under different salts', () => {
    const s1 = Buffer.from('a'.repeat(64), 'hex');
    const s2 = Buffer.from('b'.repeat(64), 'hex');
    const a = hashIp(s1, '203.0.113.4');
    const b = hashIp(s2, '203.0.113.4');
    assert.notEqual(a, b);
  });

  it('returns null for null/undefined IPs', () => {
    const salt = Buffer.from('a'.repeat(64), 'hex');
    assert.equal(hashIp(salt, null), null);
    assert.equal(hashIp(salt, undefined), null);
  });

  it('records ipHash via the service end-to-end', async () => {
    const row = await svc.record('Notes/foo.md', 'alice@x.com', 'view', '203.0.113.4', 1_000_000);
    assert.ok(row);
    assert.match(row!.ipHash!, /^[0-9a-f]{16}$/);
  });
});

describe('resolveIpSalt persistence', () => {
  it('persists a generated salt to disk and reuses it on subsequent calls', () => {
    delete process.env.ACCESS_LOG_IP_SALT;
    try {
      const saltPath = path.join(tmpDir, '.access-log-salt');
      // Ensure the file does not yet exist.
      try { fs.unlinkSync(saltPath); } catch { /* ignore */ }
      const a = resolveIpSalt(saltPath);
      const b = resolveIpSalt(saltPath);
      assert.deepEqual(a, b);
      assert.ok(a.length >= 16);
      assert.ok(fs.existsSync(saltPath));
    } finally {
      process.env.ACCESS_LOG_IP_SALT = 'a'.repeat(64);
    }
  });

  it('prefers ACCESS_LOG_IP_SALT env over the file', () => {
    const saltPath = path.join(tmpDir, '.access-log-salt-2');
    fs.writeFileSync(saltPath, Buffer.from('zz'.repeat(16), 'utf8'));
    process.env.ACCESS_LOG_IP_SALT = 'b'.repeat(64);
    try {
      const fromEnv = resolveIpSalt(saltPath);
      const expected = Buffer.from('b'.repeat(64), 'hex');
      assert.deepEqual(fromEnv, expected);
    } finally {
      process.env.ACCESS_LOG_IP_SALT = 'a'.repeat(64);
    }
  });
});

describe('AccessLogService.summaryForPath', () => {
  it('aggregates view + edit counts and last-ts per active grantee', async () => {
    const t0 = 1_000_000;
    const path = 'Notes/foo.md';
    await svc.record(path, 'bob@x.com', 'view', null, t0);
    await svc.record(path, 'bob@x.com', 'view', null, t0 + 6 * 60_000);
    await svc.record(path, 'bob@x.com', 'edit', null, t0 + 7 * 60_000);
    await svc.record(path, 'carol@x.com', 'view', null, t0 + 8 * 60_000);

    const summary = await svc.summaryForPath(path, ['bob@x.com', 'carol@x.com']);
    const bob = summary.rows.find((r) => r.email === 'bob@x.com')!;
    const carol = summary.rows.find((r) => r.email === 'carol@x.com')!;
    assert.equal(bob.view_count, 2);
    assert.equal(bob.last_view_at, t0 + 6 * 60_000);
    assert.equal(bob.last_edit_at, t0 + 7 * 60_000);
    assert.equal(carol.view_count, 1);
    assert.equal(carol.last_view_at, t0 + 8 * 60_000);
    assert.equal(carol.last_edit_at, null);
  });

  it('emits a zero-count row for active grantees with no log activity', async () => {
    const path = 'Notes/foo.md';
    await svc.record(path, 'bob@x.com', 'view', null, 1_000_000);

    const summary = await svc.summaryForPath(path, ['bob@x.com', 'dave@x.com']);
    const dave = summary.rows.find((r) => r.email === 'dave@x.com')!;
    assert.equal(dave.view_count, 0);
    assert.equal(dave.last_view_at, null);
    assert.equal(dave.last_edit_at, null);
  });

  it('drops viewers not in the active-grant list (revoked + owner-self)', async () => {
    const path = 'Notes/foo.md';
    // dan was revoked; alice is the owner — neither passed in granteeEmails.
    await svc.record(path, 'dan@x.com', 'view', null, 1_000_000);
    await svc.record(path, 'alice@x.com', 'view', null, 1_010_000);
    await svc.record(path, 'bob@x.com', 'view', null, 1_020_000);

    const summary = await svc.summaryForPath(path, ['bob@x.com']);
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.rows[0].email, 'bob@x.com');
  });

  it('counts fetched rows toward view_count (E2E paths log fetched)', async () => {
    const path = '_users/alice@x.com/_secure/journal.md';
    await svc.record(path, 'bob@x.com', 'fetched', null, 1_000_000);
    await svc.record(path, 'bob@x.com', 'fetched', null, 1_000_000 + 6 * 60_000);

    const summary = await svc.summaryForPath(path, ['bob@x.com'], {
      includeAnonymous: false,
    });
    assert.equal(summary.rows[0].view_count, 2);
    assert.equal(summary.anonymous, null);
  });

  it('aggregates anonymous share-link resolves separately from grantee rows', async () => {
    const path = 'Notes/foo.md';
    await svc.record(path, 'anonymous', 'share-link-resolved', null, 1_000_000);
    await svc.record(path, 'anonymous', 'share-link-resolved', null, 1_000_000 + 6 * 60_000);
    await svc.record(path, 'anonymous', 'share-link-resolved', null, 1_000_000 + 12 * 60_000);

    const summary = await svc.summaryForPath(path, []);
    assert.equal(summary.rows.length, 0);
    assert.ok(summary.anonymous);
    assert.equal(summary.anonymous!.resolve_count, 3);
    assert.equal(summary.anonymous!.last_resolve_at, 1_000_000 + 12 * 60_000);
  });

  it('returns anonymous: null when includeAnonymous is false', async () => {
    const path = '_users/alice@x.com/_secure/journal.md';
    await svc.record(path, 'anonymous', 'share-link-resolved', null, 1_000_000);

    const summary = await svc.summaryForPath(path, [], { includeAnonymous: false });
    assert.equal(summary.anonymous, null);
  });
});

describe('AccessLogService listForPath / deleteForViewer / deleteOlderThan', () => {
  it('lists rows for a path, newest first, respecting limit', async () => {
    const t0 = 1_000_000;
    await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0);
    await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0 + 10 * 60_000);
    await svc.record('Notes/foo.md', 'bob@x.com', 'view', null, t0 + 20 * 60_000);
    const rows = await svc.listForPath('Notes/foo.md', undefined, 10);
    assert.equal(rows.length, 3);
    assert.ok(rows[0].ts >= rows[1].ts && rows[1].ts >= rows[2].ts);
  });

  it('deleteForViewer removes only that viewer rows', async () => {
    const t0 = 1_000_000;
    await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0);
    await svc.record('Notes/foo.md', 'bob@x.com', 'view', null, t0 + 10 * 60_000);
    const deleted = await svc.deleteForViewer('alice@x.com');
    assert.equal(deleted, 1);
    const remaining = await repo.find();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].viewerEmail, 'bob@x.com');
  });

  it('deleteOlderThan prunes rows below the cutoff', async () => {
    const t0 = 1_000_000;
    await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0);
    await svc.record('Notes/foo.md', 'alice@x.com', 'view', null, t0 + 10 * 60_000);
    const deleted = await svc.deleteOlderThan(t0 + 5 * 60_000);
    assert.equal(deleted, 1);
    const remaining = await repo.find();
    assert.equal(remaining.length, 1);
  });
});
