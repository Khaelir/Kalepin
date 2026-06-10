import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DocumentGrant } from '../entities/document-grant.entity';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from './grant-aware-visibility.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

let ds: DataSource;
let grants: GrantsService;
let visibility: GrantAwareVisibility;

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  visibility = new GrantAwareVisibility(grants);
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

describe('GrantAwareVisibility — truth table', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('owner: own personal path → owner', async () => {
    const v = await visibility.visibilityFor('_users/alice@example.com/diary.md', ALICE);
    assert.equal(v.kind, 'owner');
  });

  it('owner: shared vault path → owner', async () => {
    const v = await visibility.visibilityFor('Notes/foo.md', BOB);
    assert.equal(v.kind, 'owner');
  });

  it('foreign personal, no grant → denied', async () => {
    const v = await visibility.visibilityFor('_users/alice@example.com/diary.md', BOB);
    assert.equal(v.kind, 'denied');
  });

  it('foreign personal, read grant → grant.read', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'read',
    });
    const v = await visibility.visibilityFor('_users/alice@example.com/diary.md', BOB);
    assert.equal(v.kind, 'grant');
    if (v.kind === 'grant') assert.equal(v.permission, 'read');
  });

  it('foreign personal, write grant → grant.write', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'write',
    });
    const v = await visibility.visibilityFor('_users/alice@example.com/diary.md', BOB);
    assert.equal(v.kind, 'grant');
    if (v.kind === 'grant') assert.equal(v.permission, 'write');
  });

  it('foreign personal, expired grant → denied', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'read',
      expiresAt: Date.now() - 1000,
    });
    const v = await visibility.visibilityFor('_users/alice@example.com/diary.md', BOB);
    assert.equal(v.kind, 'denied');
  });

  it('foreign personal, revoked grant → denied', async () => {
    const g = await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'read',
    });
    await grants.revoke(g.id);
    const v = await visibility.visibilityFor('_users/alice@example.com/diary.md', BOB);
    assert.equal(v.kind, 'denied');
  });
});

describe('GrantAwareVisibility — assertReadableBy', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('owner allowed', async () => {
    await visibility.assertReadableBy('_users/alice@example.com/diary.md', ALICE);
    await visibility.assertReadableBy('Notes/x.md', BOB);
  });

  it('grant.read allowed', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'read',
    });
    await visibility.assertReadableBy('_users/alice@example.com/diary.md', BOB);
  });

  it('denied → NotFoundException', async () => {
    await assert.rejects(
      () => visibility.assertReadableBy('_users/alice@example.com/diary.md', BOB),
      (e: any) => e instanceof NotFoundException,
    );
  });
});

describe('GrantAwareVisibility — assertWritableBy', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('owner allowed', async () => {
    await visibility.assertWritableBy('_users/alice@example.com/diary.md', ALICE);
  });

  it('grant.write allowed', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'write',
    });
    await visibility.assertWritableBy('_users/alice@example.com/diary.md', BOB);
  });

  it('grant.read on write → ForbiddenException', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'read',
    });
    await assert.rejects(
      () => visibility.assertWritableBy('_users/alice@example.com/diary.md', BOB),
      (e: any) => e instanceof ForbiddenException,
    );
  });

  it('grant.comment on write → ForbiddenException', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'comment',
    });
    await assert.rejects(
      () => visibility.assertWritableBy('_users/alice@example.com/diary.md', BOB),
      (e: any) => e instanceof ForbiddenException,
    );
  });

  it('no grant → NotFoundException (404, never 403)', async () => {
    await assert.rejects(
      () => visibility.assertWritableBy('_users/alice@example.com/diary.md', BOB),
      (e: any) => e instanceof NotFoundException,
    );
  });
});

describe('GrantAwareVisibility — assertCommentableBy', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('grant.comment allowed', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'comment',
    });
    await visibility.assertCommentableBy('_users/alice@example.com/diary.md', BOB);
  });

  it('grant.write allowed', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'write',
    });
    await visibility.assertCommentableBy('_users/alice@example.com/diary.md', BOB);
  });

  it('grant.read → ForbiddenException', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB,
      path: '_users/alice@example.com/diary.md', permission: 'read',
    });
    await assert.rejects(
      () => visibility.assertCommentableBy('_users/alice@example.com/diary.md', BOB),
      (e: any) => e instanceof ForbiddenException,
    );
  });

  it('no grant → NotFoundException', async () => {
    await assert.rejects(
      () => visibility.assertCommentableBy('_users/alice@example.com/diary.md', BOB),
      (e: any) => e instanceof NotFoundException,
    );
  });
});

describe('GrantAwareVisibility — visibleGrantSet', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns the set of paths the user can see via active grants', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/a.md', permission: 'read',
    });
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/b.md', permission: 'write',
    });
    const set = await visibility.visibleGrantSet(BOB);
    assert.equal(set.size, 2);
    assert.ok(set.has('_users/alice@example.com/a.md'));
    assert.ok(set.has('_users/alice@example.com/b.md'));
  });

  it('expired/revoked grants excluded', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/a.md',
      permission: 'read', expiresAt: Date.now() - 1000,
    });
    const g = await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: '_users/alice@example.com/b.md', permission: 'read',
    });
    await grants.revoke(g.id);
    const set = await visibility.visibleGrantSet(BOB);
    assert.equal(set.size, 0);
  });
});
