import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { NoteAccessLog } from '../entities/note-access-log.entity';
import { AccessLogService } from './access-log.service';
import { AccessLogController } from './access-log.controller';
import { AccessLogRetentionService, retentionDays } from './access-log-retention.service';
import { GrantsService } from '../grants/grants.service';
import { DocumentGrant } from '../entities/document-grant.entity';
import type { EncryptionPredicates } from '../crypto/encryption-predicates';

let ds: DataSource;
let repo: Repository<NoteAccessLog>;
let svc: AccessLogService;
let grants: GrantsService;
let ctrl: AccessLogController;

const passthroughPredicates: EncryptionPredicates = {
  isEncryptedAtRest: () => false,
  isE2EEncrypted: () => false,
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
};

before(() => {
  process.env.ACCESS_LOG_IP_SALT = 'a'.repeat(64);
  process.env.ADMIN_EMAILS = 'admin@example.com';
});

after(() => {
  delete process.env.ACCESS_LOG_IP_SALT;
  delete process.env.ADMIN_EMAILS;
  delete process.env.ACCESS_LOG_RETENTION_DAYS;
});

beforeEach(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [NoteAccessLog, DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(NoteAccessLog);
  svc = new AccessLogService(repo);
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  ctrl = new AccessLogController(svc, grants, passthroughPredicates);
});

afterEach(async () => {
  await ds.destroy();
});

function reqAs(email: string): any {
  return { user: { email }, ip: '203.0.113.4' };
}

async function seedRow(path: string, viewer: string, action: any, ts: number) {
  await repo.save(repo.create({ path, viewerEmail: viewer, action, ipHash: null, ts }));
}

describe('AccessLogController.listForPath — owner/admin/non-owner', () => {
  it('owner of a personal path sees rows', async () => {
    const path = '_users/alice@example.com/foo.md';
    await seedRow(path, 'alice@example.com', 'view', 1_000_000);
    const res = await ctrl.listForPath(
      encodeURIComponent(path),
      undefined,
      undefined,
      reqAs('alice@example.com'),
    );
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].viewer_email, 'alice@example.com');
  });

  it('admin sees rows on a foreign personal path', async () => {
    const path = '_users/alice@example.com/foo.md';
    await seedRow(path, 'alice@example.com', 'view', 1_000_000);
    const res = await ctrl.listForPath(
      encodeURIComponent(path),
      undefined,
      undefined,
      reqAs('admin@example.com'),
    );
    assert.equal(res.rows.length, 1);
  });

  it('non-owner non-admin gets 403 on a foreign personal path', async () => {
    const path = '_users/alice@example.com/foo.md';
    await seedRow(path, 'alice@example.com', 'view', 1_000_000);
    await assert.rejects(
      () =>
        ctrl.listForPath(
          encodeURIComponent(path),
          undefined,
          undefined,
          reqAs('bob@example.com'),
        ),
      ForbiddenException,
    );
  });

  it('honors `since` and orders newest-first', async () => {
    const path = 'Notes/foo.md';
    await seedRow(path, 'alice@example.com', 'view', 1_000_000);
    await seedRow(path, 'alice@example.com', 'view', 1_500_000);
    await seedRow(path, 'alice@example.com', 'view', 2_000_000);
    const res = await ctrl.listForPath(
      encodeURIComponent(path),
      '1_400_000'.replace(/_/g, ''),
      undefined,
      reqAs('alice@example.com'),
    );
    assert.equal(res.rows.length, 2);
    assert.ok(res.rows[0].ts >= res.rows[1].ts);
  });
});

describe('AccessLogController.summaryForPath', () => {
  async function seedGrant(grantor: string, grantee: string, path: string) {
    await grants.mint({
      grantorEmail: grantor,
      granteeEmail: grantee,
      path,
      permission: 'read',
      expiresAt: null,
    });
  }

  it('owner sees view counts only for active grantees', async () => {
    const path = '_users/alice@example.com/foo.md';
    await seedGrant('alice@example.com', 'bob@example.com', path);
    await seedGrant('alice@example.com', 'carol@example.com', path);
    // 12 views by Bob, 4 by Carol
    for (let i = 0; i < 12; i++) {
      await seedRow(path, 'bob@example.com', 'view', 1_000_000 + i * 6 * 60_000);
    }
    for (let i = 0; i < 4; i++) {
      await seedRow(path, 'carol@example.com', 'view', 2_000_000 + i * 6 * 60_000);
    }

    const res = await ctrl.summaryForPath(
      encodeURIComponent(path),
      reqAs('alice@example.com'),
    );
    const bob = res.grantees.find((r) => r.email === 'bob@example.com')!;
    const carol = res.grantees.find((r) => r.email === 'carol@example.com')!;
    assert.equal(bob.view_count, 12);
    assert.equal(carol.view_count, 4);
  });

  it('excludes a revoked grantee that previously viewed', async () => {
    const path = '_users/alice@example.com/foo.md';
    const dan = await grants.mint({
      grantorEmail: 'alice@example.com',
      granteeEmail: 'dan@example.com',
      path,
      permission: 'read',
      expiresAt: null,
    });
    await seedRow(path, 'dan@example.com', 'view', 1_000_000);
    await grants.revoke(dan.id);

    const res = await ctrl.summaryForPath(
      encodeURIComponent(path),
      reqAs('alice@example.com'),
    );
    assert.equal(res.grantees.find((r) => r.email === 'dan@example.com'), undefined);
  });

  it('aggregates anonymous share-link resolves on `anonymous`', async () => {
    const path = '_users/alice@example.com/foo.md';
    await seedRow(path, 'anonymous', 'share-link-resolved', 1_000_000);
    await seedRow(path, 'anonymous', 'share-link-resolved', 1_000_000 + 6 * 60_000);

    const res = await ctrl.summaryForPath(
      encodeURIComponent(path),
      reqAs('alice@example.com'),
    );
    assert.ok(res.anonymous);
    assert.equal(res.anonymous!.resolve_count, 2);
  });

  it('non-owner non-admin gets 403', async () => {
    const path = '_users/alice@example.com/foo.md';
    await seedRow(path, 'bob@example.com', 'view', 1_000_000);

    await assert.rejects(
      () =>
        ctrl.summaryForPath(
          encodeURIComponent(path),
          reqAs('bob@example.com'),
        ),
      ForbiddenException,
    );
  });

  it('E2E path returns anonymous: null', async () => {
    const path = '_users/alice@example.com/_secure/journal.md';
    const e2ePredicates = {
      ...passthroughPredicates,
      isE2EEncrypted: (p: string) => p.includes('/_secure'),
    };
    const e2eCtrl = new AccessLogController(svc, grants, e2ePredicates);
    // (no anonymous rows can exist for E2E paths in practice; the carve-out
    // is what the controller tells the service)

    const res = await e2eCtrl.summaryForPath(
      encodeURIComponent(path),
      reqAs('alice@example.com'),
    );
    assert.equal(res.anonymous, null);
  });
});

describe('AccessLogController right-to-erasure', () => {
  it('eraseMine deletes only the requester rows', async () => {
    await seedRow('Notes/a.md', 'alice@example.com', 'view', 1_000_000);
    await seedRow('Notes/a.md', 'alice@example.com', 'edit', 1_000_001);
    await seedRow('Notes/a.md', 'bob@example.com', 'view', 1_000_002);
    const res = await ctrl.eraseMine(reqAs('alice@example.com'));
    assert.equal(res.deleted, 2);
    const rest = await repo.find();
    assert.equal(rest.length, 1);
    assert.equal(rest[0].viewerEmail, 'bob@example.com');
  });

  it('admin can erase another user rows', async () => {
    await seedRow('Notes/a.md', 'bob@example.com', 'view', 1_000_000);
    const res = await ctrl.eraseForUser(
      encodeURIComponent('bob@example.com'),
      reqAs('admin@example.com'),
    );
    assert.equal(res.deleted, 1);
    assert.equal((await repo.find()).length, 0);
  });

  it('non-admin cannot use the admin erasure endpoint', async () => {
    await seedRow('Notes/a.md', 'bob@example.com', 'view', 1_000_000);
    await assert.rejects(
      () =>
        ctrl.eraseForUser(
          encodeURIComponent('bob@example.com'),
          reqAs('alice@example.com'),
        ),
      ForbiddenException,
    );
  });
});

describe('AccessLogRetentionService', () => {
  it('respects ACCESS_LOG_RETENTION_DAYS=0 → no pruning', async () => {
    await seedRow('Notes/a.md', 'alice@example.com', 'view', 1);
    process.env.ACCESS_LOG_RETENTION_DAYS = '0';
    const cron = new AccessLogRetentionService(svc);
    await cron.prune();
    delete process.env.ACCESS_LOG_RETENTION_DAYS;
    assert.equal((await repo.find()).length, 1);
  });

  it('prunes rows older than retention window', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // 31d-old row should go; 1d-old row should stay.
    await seedRow('Notes/a.md', 'alice@example.com', 'view', now - 31 * DAY);
    await seedRow('Notes/a.md', 'alice@example.com', 'view', now - 1 * DAY);
    process.env.ACCESS_LOG_RETENTION_DAYS = '30';
    const cron = new AccessLogRetentionService(svc);
    await cron.prune();
    delete process.env.ACCESS_LOG_RETENTION_DAYS;
    const rest = await repo.find();
    assert.equal(rest.length, 1);
    assert.ok(rest[0].ts > now - 2 * DAY);
  });

  it('retentionDays() defaults to 90 for unset / invalid env', () => {
    delete process.env.ACCESS_LOG_RETENTION_DAYS;
    assert.equal(retentionDays(), 90);
    process.env.ACCESS_LOG_RETENTION_DAYS = 'banana';
    assert.equal(retentionDays(), 90);
    process.env.ACCESS_LOG_RETENTION_DAYS = '-7';
    assert.equal(retentionDays(), 90);
    delete process.env.ACCESS_LOG_RETENTION_DAYS;
  });
});
