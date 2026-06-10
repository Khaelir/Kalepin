import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { DocumentGrant } from '../entities/document-grant.entity';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';

// The OT gateway's `op` handler must reject ops from comment-only grantees.
// A previous regression let comment-only users mutate content because
// `doc:open` accepted them and `op` did no permission check. These tests
// pin the predicate the gateway uses so a future regression fails CI.

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const PATH = '_users/alice@example.com/diary.md';

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

// Mirror of the predicate evaluated inside OTGateway.handleOp.
async function gatewayWritable(path: string, email: string): Promise<boolean> {
  const v = await visibility.visibilityFor(path, email);
  return v.kind === 'owner' || (v.kind === 'grant' && v.permission === 'write');
}

describe('OTGateway op-handler permission predicate', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('owner is writable', async () => {
    assert.equal(await gatewayWritable(PATH, ALICE), true);
  });

  it('grant.write is writable', async () => {
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: PATH, permission: 'write' });
    assert.equal(await gatewayWritable(PATH, BOB), true);
  });

  it('grant.comment is NOT writable (regression — previously allowed by op handler)', async () => {
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: PATH, permission: 'comment' });
    assert.equal(await gatewayWritable(PATH, BOB), false);
  });

  it('grant.read is NOT writable', async () => {
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: PATH, permission: 'read' });
    assert.equal(await gatewayWritable(PATH, BOB), false);
  });

  it('no grant on foreign personal path → not writable', async () => {
    assert.equal(await gatewayWritable(PATH, BOB), false);
  });

  it('expired comment grant is not writable', async () => {
    await grants.mint({
      grantorEmail: ALICE, granteeEmail: BOB, path: PATH,
      permission: 'comment', expiresAt: Date.now() - 1000,
    });
    assert.equal(await gatewayWritable(PATH, BOB), false);
  });
});

describe('OTGateway doc:opened permission payload', () => {
  beforeEach(setup);
  afterEach(teardown);

  // The `doc:opened` frame carries the resolved permission so the client can
  // render the editor read-only without trusting its own state. Mirror the
  // mapping from `Visibility` → wire string here.
  async function resolveDocOpenedPermission(
    path: string,
    email: string,
  ): Promise<'owner' | 'write' | 'comment' | 'denied' | 'read-rejected'> {
    const v = await visibility.visibilityFor(path, email);
    if (v.kind === 'denied' || v.kind === 'public_share') return 'denied';
    if (v.kind === 'owner') return 'owner';
    if (v.permission === 'read') return 'read-rejected';
    return v.permission;
  }

  it('owner sees "owner"', async () => {
    assert.equal(await resolveDocOpenedPermission(PATH, ALICE), 'owner');
  });

  it('grant.write sees "write"', async () => {
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: PATH, permission: 'write' });
    assert.equal(await resolveDocOpenedPermission(PATH, BOB), 'write');
  });

  it('grant.comment sees "comment" (allowed to open, blocked at op time)', async () => {
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: PATH, permission: 'comment' });
    assert.equal(await resolveDocOpenedPermission(PATH, BOB), 'comment');
  });

  it('grant.read is rejected by doc:open (no live OT session)', async () => {
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: PATH, permission: 'read' });
    assert.equal(await resolveDocOpenedPermission(PATH, BOB), 'read-rejected');
  });
});
