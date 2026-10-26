import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { DocumentGrant } from '../entities/document-grant.entity';
import { GrantsService } from './grants.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';

let ds: DataSource;
let repo: Repository<DocumentGrant>;
let service: GrantsService;

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(DocumentGrant);
  service = new GrantsService(repo);
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

describe('GrantsService — lifecycle', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('mint inserts an active row with the requested permission', async () => {
    const g = await service.mint({
      grantorEmail: ALICE,
      granteeEmail: BOB,
      path: '_users/alice@example.com/foo.md',
      permission: 'read',
    });
    assert.ok(g.id > 0);
    assert.equal(g.revokedAt, null);
    assert.equal(g.permission, 'read');
    assert.equal(g.expiresAt, null);
  });

  it('findActive returns the grant for the matching pair', async () => {
    await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'write',
    });
    const found = await service.findActive('p.md', BOB);
    assert.ok(found);
    assert.equal(found!.permission, 'write');
  });

  it('findActive returns null for non-grantee', async () => {
    await service.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read' });
    const found = await service.findActive('p.md', CAROL);
    assert.equal(found, null);
  });

  it('listForGrantee returns active grants in DESC createdAt order', async () => {
    await service.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: 'a.md', permission: 'read' });
    await new Promise((r) => setTimeout(r, 5));
    await service.mint({ grantorEmail: CAROL, granteeEmail: BOB, path: 'b.md', permission: 'write' });
    const list = await service.listForGrantee(BOB);
    assert.equal(list.length, 2);
    assert.equal(list[0].path, 'b.md');
  });

  it('listForGrantor lists active grants only by default', async () => {
    const g1 = await service.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: 'a.md', permission: 'read' });
    await service.mint({ grantorEmail: ALICE, granteeEmail: CAROL, path: 'b.md', permission: 'read' });
    await service.revoke(g1.id);
    const active = await service.listForGrantor(ALICE);
    assert.equal(active.length, 1);
    assert.equal(active[0].path, 'b.md');
    const all = await service.listForGrantor(ALICE, true);
    assert.equal(all.length, 2);
  });

  it('revoke sets revokedAt and findActive returns null afterwards', async () => {
    const g = await service.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read' });
    await service.revoke(g.id);
    const found = await service.findActive('p.md', BOB);
    assert.equal(found, null);
    const fresh = await service.findById(g.id);
    assert.ok(fresh!.revokedAt !== null);
  });

  it('revoke is idempotent — second call does not change the timestamp', async () => {
    const g = await service.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read' });
    const r1 = await service.revoke(g.id);
    const r2 = await service.revoke(g.id);
    assert.equal(r1!.revokedAt, r2!.revokedAt);
  });

  it('revoke returns null for unknown id', async () => {
    const res = await service.revoke(9999);
    assert.equal(res, null);
  });

  it('findActive picks the highest permission when multiple grants exist', async () => {
    // mint() now upserts on (path, grantee) so two `mint` calls would only
    // produce one row. Insert directly via the repo to simulate legacy data
    // (or a race) where two active rows coexist for the same pair.
    await repo.save(repo.create({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read',
      createdAt: Date.now(), revokedAt: null, expiresAt: null,
    }));
    await repo.save(repo.create({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'write',
      createdAt: Date.now(), revokedAt: null, expiresAt: null,
    }));
    const found = await service.findActive('p.md', BOB);
    assert.equal(found!.permission, 'write');
  });

  it('mint upserts an active grant for the same (path, grantee)', async () => {
    const first = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read',
    });
    const second = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'write',
      expiresAt: 999_000_000,
    });
    assert.equal(second.id, first.id, 'second mint reuses the existing row');
    assert.equal(second.permission, 'write');
    assert.equal(second.expiresAt, 999_000_000);
    const all = await repo.find({ where: { path: 'p.md', granteeEmail: BOB } });
    assert.equal(all.length, 1, 'no duplicate row created');
  });

  it('mint creates a new grant after the previous one was revoked', async () => {
    const first = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read',
    });
    await service.revoke(first.id);
    const second = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'write',
    });
    assert.notEqual(second.id, first.id);
    assert.equal(second.permission, 'write');
  });
});

describe('GrantsService — expiry', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('expired grant is not returned by findActive', async () => {
    await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read',
      expiresAt: Date.now() - 1000,
    });
    const found = await service.findActive('p.md', BOB);
    assert.equal(found, null);
  });

  it('future expiry is still active', async () => {
    await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read',
      expiresAt: Date.now() + 1_000_000,
    });
    const found = await service.findActive('p.md', BOB);
    assert.ok(found);
  });

  it('null expiry is perpetual', async () => {
    await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read', expiresAt: null,
    });
    const found = await service.findActive('p.md', BOB, Number.MAX_SAFE_INTEGER);
    assert.ok(found);
  });

  it('listForGrantee filters out expired grants', async () => {
    await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'a.md', permission: 'read',
      expiresAt: Date.now() - 1000,
    });
    await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'b.md', permission: 'read',
    });
    const list = await service.listForGrantee(BOB);
    assert.equal(list.length, 1);
    assert.equal(list[0].path, 'b.md');
  });
});

describe('GrantsService — cascadeRename', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('renames an exact-match grant', async () => {
    const g = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/old.md', permission: 'read',
    });
    await service.cascadeRename(
      '_users/alice@example.com/old.md',
      '_users/alice@example.com/new.md',
    );
    const fresh = await service.findById(g.id);
    assert.equal(fresh!.path, '_users/alice@example.com/new.md');
  });

  it('renames descendant grants via prefix replacement', async () => {
    const g1 = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/folder/a.md', permission: 'read',
    });
    const g2 = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/folder/sub/b.md', permission: 'write',
    });
    await service.cascadeRename(
      '_users/alice@example.com/folder',
      '_users/alice@example.com/renamed',
    );
    assert.equal((await service.findById(g1.id))!.path, '_users/alice@example.com/renamed/a.md');
    assert.equal((await service.findById(g2.id))!.path, '_users/alice@example.com/renamed/sub/b.md');
  });

  it('does NOT touch grants on sibling paths sharing a prefix', async () => {
    const sibling = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/folder2/c.md', permission: 'read',
    });
    await service.cascadeRename(
      '_users/alice@example.com/folder',
      '_users/alice@example.com/renamed',
    );
    assert.equal((await service.findById(sibling.id))!.path, '_users/alice@example.com/folder2/c.md');
  });

  it('does NOT touch revoked grants', async () => {
    const g = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/old.md', permission: 'read',
    });
    await service.revoke(g.id);
    await service.cascadeRename(
      '_users/alice@example.com/old.md',
      '_users/alice@example.com/new.md',
    );
    const fresh = await service.findById(g.id);
    assert.equal(fresh!.path, '_users/alice@example.com/old.md');
  });
});

describe('GrantsService — cascadeDelete', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('revokes an exact-match grant', async () => {
    const g = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read',
    });
    const n = await service.cascadeDelete('p.md');
    assert.equal(n, 1);
    const fresh = await service.findById(g.id);
    assert.ok(fresh!.revokedAt !== null);
  });

  it('revokes descendant grants when a folder is deleted', async () => {
    const g1 = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'folder/a.md', permission: 'read',
    });
    const g2 = await service.mint({
      grantorEmail: ALICE, granteeEmail: CAROL, path: 'folder/b.md', permission: 'write',
    });
    const n = await service.cascadeDelete('folder');
    assert.equal(n, 2);
    assert.ok((await service.findById(g1.id))!.revokedAt !== null);
    assert.ok((await service.findById(g2.id))!.revokedAt !== null);
  });

  it('does NOT touch sibling-prefix grants', async () => {
    const sibling = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'folder2/c.md', permission: 'read',
    });
    await service.cascadeDelete('folder');
    assert.equal((await service.findById(sibling.id))!.revokedAt, null);
  });

  it('is idempotent — already-revoked rows stay revoked', async () => {
    const g = await service.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: 'p.md', permission: 'read',
    });
    const r1 = await service.revoke(g.id);
    const t1 = r1!.revokedAt;
    await service.cascadeDelete('p.md');
    const fresh = await service.findById(g.id);
    assert.equal(fresh!.revokedAt, t1);
  });
});

describe('GrantsService — prefix cascades treat folder names literally', () => {
  beforeEach(setup);
  afterEach(teardown);

  const VICTIM = '_users/alice@example.com/hr/review.md';

  for (const folder of ['__sers', '_Users', '%']) {
    it(`moving or deleting "${folder}" leaves _users/ grants alone`, async () => {
      const g = await service.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: VICTIM, permission: 'read' });
      await service.cascadeRename(folder, 'M');
      assert.equal((await service.findById(g.id))!.path, VICTIM);
      assert.equal(await service.cascadeDelete(folder), 0);
      assert.equal((await service.findById(g.id))!.revokedAt, null);
    });
  }

  it('still rewrites real descendants on rename', async () => {
    const g = await service.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: 'folder/sub/a.md', permission: 'read' });
    await service.cascadeRename('folder', 'renamed');
    assert.equal((await service.findById(g.id))!.path, 'renamed/sub/a.md');
  });
});
