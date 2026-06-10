import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DocumentGrant } from '../entities/document-grant.entity';
import { GrantsService } from './grants.service';
import { GrantsController } from './grants.controller';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

const passthroughPredicates = {
  isEncryptedAtRest: () => false,
  isE2EEncrypted: () => false,
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
} as const;

let ds: DataSource;
let grants: GrantsService;
let visibility: GrantAwareVisibility;
let controller: GrantsController;

async function setup(predicates = passthroughPredicates) {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  visibility = new GrantAwareVisibility(grants);
  controller = new GrantsController(grants, visibility, predicates as any);
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

function makeReq(email: string): any {
  return { user: { email, sub: 1 } };
}

describe('GrantsController.mint', () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it('owner mints a read grant', async () => {
    const result = await controller.mint(
      { grantee_email: BOB, path: `_users/${ALICE}/foo.md`, permission: 'read' },
      makeReq(ALICE),
    );
    assert.ok(result.id > 0);
    const grant = await grants.findActive(`_users/${ALICE}/foo.md`, BOB);
    assert.equal(grant!.permission, 'read');
  });

  it('non-owner cannot mint on a foreign personal path', async () => {
    await assert.rejects(
      () => controller.mint(
        { grantee_email: 'carol@example.com', path: `_users/${ALICE}/foo.md`, permission: 'read' },
        makeReq(BOB),
      ),
      (e: any) => e instanceof ForbiddenException || e instanceof NotFoundException,
    );
  });

  it('rejects self-grant', async () => {
    await assert.rejects(
      () => controller.mint(
        { grantee_email: ALICE, path: `_users/${ALICE}/foo.md`, permission: 'read' },
        makeReq(ALICE),
      ),
      (e: any) => e instanceof BadRequestException,
    );
  });

  it('rejects unknown permission', async () => {
    await assert.rejects(
      () => controller.mint(
        { grantee_email: BOB, path: `_users/${ALICE}/foo.md`, permission: 'admin' as any },
        makeReq(ALICE),
      ),
      (e: any) => e instanceof BadRequestException,
    );
  });

  it('rejects E2E paths with a clear error', async () => {
    await teardown();
    await setup({ ...passthroughPredicates, isE2EEncrypted: () => true });
    await assert.rejects(
      () => controller.mint(
        { grantee_email: BOB, path: `_users/${ALICE}/_secure/journal.md`, permission: 'read' },
        makeReq(ALICE),
      ),
      (e: any) => e instanceof BadRequestException && /E2E|secure/.test(e.message),
    );
  });

  it('honors expires_at', async () => {
    const exp = Date.now() + 5_000;
    await controller.mint(
      { grantee_email: BOB, path: `_users/${ALICE}/foo.md`, permission: 'read', expires_at: exp },
      makeReq(ALICE),
    );
    const list = await grants.listForGrantee(BOB);
    assert.equal(list[0].expiresAt, exp);
  });
});

describe('GrantsController.revoke', () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it('grantor can revoke', async () => {
    const r = await controller.mint(
      { grantee_email: BOB, path: `_users/${ALICE}/foo.md`, permission: 'read' },
      makeReq(ALICE),
    );
    await controller.revoke(String(r.id), makeReq(ALICE));
    const found = await grants.findActive(`_users/${ALICE}/foo.md`, BOB);
    assert.equal(found, null);
  });

  it('grantee cannot revoke', async () => {
    const r = await controller.mint(
      { grantee_email: BOB, path: `_users/${ALICE}/foo.md`, permission: 'read' },
      makeReq(ALICE),
    );
    await assert.rejects(
      () => controller.revoke(String(r.id), makeReq(BOB)),
      (e: any) => e instanceof ForbiddenException,
    );
  });

  it('admin can revoke another user\'s grant', async () => {
    const oldAdmins = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'admin@example.com';
    try {
      const r = await controller.mint(
        { grantee_email: BOB, path: `_users/${ALICE}/foo.md`, permission: 'read' },
        makeReq(ALICE),
      );
      await controller.revoke(String(r.id), makeReq('admin@example.com'));
      const found = await grants.findActive(`_users/${ALICE}/foo.md`, BOB);
      assert.equal(found, null);
    } finally {
      process.env.ADMIN_EMAILS = oldAdmins;
    }
  });
});

describe('GrantsController.list', () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it('lists active grants for grantee by default', async () => {
    await controller.mint(
      { grantee_email: BOB, path: `_users/${ALICE}/a.md`, permission: 'read' },
      makeReq(ALICE),
    );
    const result = await controller.list(undefined, undefined, makeReq(BOB));
    assert.equal(result.as, 'grantee');
    assert.equal(result.grants.length, 1);
    assert.equal(result.grants[0].path, `_users/${ALICE}/a.md`);
  });

  it('lists active grants for grantor when as=grantor', async () => {
    await controller.mint(
      { grantee_email: BOB, path: `_users/${ALICE}/a.md`, permission: 'read' },
      makeReq(ALICE),
    );
    const result = await controller.list('grantor', undefined, makeReq(ALICE));
    assert.equal(result.as, 'grantor');
    assert.equal(result.grants.length, 1);
  });
});
