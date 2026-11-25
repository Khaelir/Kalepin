import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { DocumentGrant } from '../entities/document-grant.entity';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { FilesService } from '../files/files.service';
import { OTService } from './ot.service';
import { OTGateway } from './ot.gateway';

// Visibility was checked at doc:open and on each inbound op, but nothing
// removed a grantee from the live session when their grant was revoked or
// expired: they kept receiving every edit (and presence) of the note.

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const PATH = '_users/alice@example.com/diary.md';

interface FakeSocket {
  readyState: number;
  docId?: string;
  user: { sub: number; email: string };
  sent: any[];
  send(data: string): void;
}

function fakeSocket(email: string, sub: number): FakeSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    user: { sub, email },
    sent: [],
    send(data: string) { this.sent.push(JSON.parse(data)); },
  };
}

const noopWatcher = { onFileChange() {}, onPersonalChange() {}, onDetectedRename() {} } as any;

/** Let DB queries and async handlers finish. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

let tmpRoot: string;
let ds: DataSource;
let grants: GrantsService;
let ot: OTService;
let gateway: OTGateway;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-ot-grants-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [DocumentGrant], synchronize: true });
  await ds.initialize();
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  const vault = path.join(tmpRoot, `vault-${Math.random().toString(36).slice(2)}`);
  const storage = new LocalFSAdapter(vault);
  await storage.write(PATH, 'dear diary');
  ot = new OTService(storage, { save: async () => undefined } as any, { trackChange: async () => undefined } as any);
  gateway = new OTGateway(
    ot,
    {} as any,
    noopWatcher,
    new FilesService(storage),
    { canCollab: () => true } as any,
    new GrantAwareVisibility(grants),
    { record: () => undefined } as any,
    { findOrCreateForPath: async () => 'handle-1' } as any,
    { isUnlockedFor: async () => true } as any,
    undefined,
    undefined,
    grants,
  );
});

afterEach(async () => {
  gateway.onModuleDestroy();
  mock.timers.reset();
  if (ds?.isInitialized) await ds.destroy();
});

/** Alice and Bob (write grantee) both in the session; frames so far cleared. */
async function bothEditing(expiresAt: number | null = null) {
  const grant = await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: PATH, permission: 'write', expiresAt });
  const alice = fakeSocket(ALICE, 1);
  const bob = fakeSocket(BOB, 2);
  await gateway.handleDocOpen(alice as any, { docId: PATH });
  await gateway.handleDocOpen(bob as any, { docId: PATH });
  assert.equal(bob.sent[0].type, 'doc:opened');
  alice.sent = [];
  bob.sent = [];
  return { grant, alice, bob };
}

async function aliceTypes(alice: FakeSocket): Promise<void> {
  const rev = ot.sessionManager.getRevision(PATH);
  const length = ot.sessionManager.getContent(PATH)!.length;
  await gateway.handleOp(alice as any, { docId: PATH, ops: [{ type: 'retain', count: length }, { type: 'insert', text: '!' }], rev });
}

describe('OTGateway — grantees whose access ends', () => {
  it('a revoked grantee is removed from the session and stops getting edits', async () => {
    const { grant, alice, bob } = await bothEditing();

    await grants.revoke(grant.id);
    await settle();

    assert.deepEqual(bob.sent, [{ type: 'error', code: 'not_found', docId: PATH }]);
    assert.ok(!ot.sessionManager.getClients(PATH)!.has(bob as any));
    assert.equal(bob.docId, undefined);
    assert.deepEqual(alice.sent.map((m) => m.type), ['presence:leave']);

    bob.sent = [];
    await aliceTypes(alice);
    assert.deepEqual(bob.sent, [], 'no more ops for the revoked grantee');
  });

  it('a grantee lowered to read-only is removed with forbidden', async () => {
    const { grant, bob } = await bothEditing();

    await grants.update(grant.id, { permission: 'read' });
    await settle();

    assert.deepEqual(bob.sent, [{ type: 'error', code: 'forbidden', docId: PATH }]);
    assert.ok(!ot.sessionManager.getClients(PATH)!.has(bob as any));
  });

  it('a grantee whose grant expires is removed at the next re-check', async () => {
    const { alice, bob } = await bothEditing(Date.now() + 60_000);

    mock.timers.tick(30_000);
    await settle();
    assert.ok(ot.sessionManager.getClients(PATH)!.has(bob as any), 'still valid after 30 s');

    mock.timers.tick(30_000);
    await settle();
    assert.deepEqual(bob.sent, [{ type: 'error', code: 'not_found', docId: PATH }]);

    bob.sent = [];
    await aliceTypes(alice);
    assert.deepEqual(bob.sent, []);
  });

  it('owners and still-valid grantees stay', async () => {
    const { alice, bob } = await bothEditing();
    await grants.mint({ grantorEmail: ALICE, granteeEmail: 'carol@example.com', path: PATH, permission: 'comment' });
    mock.timers.tick(30_000);
    await settle();

    assert.ok(ot.sessionManager.getClients(PATH)!.has(alice as any));
    assert.ok(ot.sessionManager.getClients(PATH)!.has(bob as any));
    assert.deepEqual(bob.sent, []);
  });
});
