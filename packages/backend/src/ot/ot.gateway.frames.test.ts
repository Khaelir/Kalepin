import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { FilesService } from '../files/files.service';
import { OTService } from './ot.service';
import { OTGateway } from './ot.gateway';

interface FakeSocket {
  readyState: number;
  docId?: string;
  user: { sub: number; email: string };
  sent: any[];
  send(data: string): void;
}

function fakeSocket(email = 'alice@example.com', sub = 1): FakeSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    user: { sub, email },
    sent: [],
    send(data: string) { this.sent.push(JSON.parse(data)); },
  };
}

const noopWatcher = { onFileChange() {}, onPersonalChange() {}, onDetectedRename() {} } as any;

let tmpRoot: string;
let storage: LocalFSAdapter;
let ot: OTService;
let gateway: OTGateway;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-ot-frames-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  mock.timers.reset();
});

beforeEach(async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const vault = path.join(tmpRoot, `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(vault, { recursive: true });
  storage = new LocalFSAdapter(vault);
  ot = new OTService(storage, { save: async () => undefined } as any, { trackChange: async () => undefined } as any);
  gateway = new OTGateway(
    ot,
    {} as any,
    noopWatcher,
    new FilesService(storage),
    { canCollab: () => true } as any,
    { visibilityFor: async () => ({ kind: 'owner' }) } as any,
    { record: () => undefined } as any,
    { findOrCreateForPath: async () => 'handle-1' } as any,
    { isUnlockedFor: async () => true } as any,
  );
});

describe('OTGateway op frames', () => {
  it('an op the session cannot place is rejected with the doc id, so only that doc\'s client resets', async () => {
    await storage.write('a.md', 'abc');
    const ws = fakeSocket();
    await gateway.handleDocOpen(ws as any, { docId: 'a.md' });
    ws.sent = [];

    await gateway.handleOp(ws as any, { docId: 'a.md', ops: [{ type: 'insert', text: 'x' }], rev: 42 });

    assert.deepEqual(ws.sent, [{ type: 'error', docId: 'a.md', message: 'Operation rejected' }]);
  });
});

describe('OTGateway presence and doc:flush frames', () => {
  // Any logged-in user could broadcast presence (their email and any
  // selection) into another user's private session, or force a flush of any
  // open session, by naming its doc id.
  const PRIVATE = '_users/alice@example.com/diary.md';

  async function aliceEditing(): Promise<FakeSocket> {
    await storage.write(PRIVATE, 'dear diary');
    const alice = fakeSocket('alice@example.com', 1);
    await gateway.handleDocOpen(alice as any, { docId: PRIVATE });
    alice.sent = [];
    return alice;
  }

  it('ignores presence from a socket that has not joined the doc', async () => {
    const alice = await aliceEditing();
    const mallory = fakeSocket('mallory@example.com', 2);

    gateway.handlePresence(mallory as any, { docId: PRIVATE, cursor: 3, selection: { from: 0, to: 4 } });

    assert.deepEqual(alice.sent, []);
  });

  it('still relays presence between sockets in the session', async () => {
    const alice = await aliceEditing();
    const tab2 = fakeSocket('alice@example.com', 1);
    await gateway.handleDocOpen(tab2 as any, { docId: PRIVATE });
    alice.sent = [];

    gateway.handlePresence(tab2 as any, { docId: PRIVATE, cursor: 3, selection: null });

    assert.equal(alice.sent.length, 1);
    assert.equal(alice.sent[0].type, 'presence');
  });

  it('ignores doc:flush from a socket that has not joined the doc', async () => {
    const alice = await aliceEditing();
    await gateway.handleOp(alice as any, { docId: PRIVATE, ops: [{ type: 'retain', count: 10 }, { type: 'insert', text: '!' }], rev: 0 });
    const mallory = fakeSocket('mallory@example.com', 2);

    await gateway.handleDocFlush(mallory as any, { docId: PRIVATE });

    assert.deepEqual(mallory.sent, []);
    assert.equal(await storage.read(PRIVATE), 'dear diary', 'not flushed');
    await gateway.handleDocFlush(alice as any, { docId: PRIVATE });
    assert.equal(await storage.read(PRIVATE), 'dear diary!');
  });
});
