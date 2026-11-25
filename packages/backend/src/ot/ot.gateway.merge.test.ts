import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileChangeEvent } from '@kalepin/shared';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { FilesService } from '../files/files.service';
import { OTService } from './ot.service';
import { OTGateway } from './ot.gateway';

// Changes that reach an open note's file without going through its session
// (another program, a server-side write) used to be ignored, so the next
// flush wrote the stale session over them, or reset the session and threw
// away its unsaved edits. They are now merged in as an op.

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

class CapturingWatcher {
  shared: Array<(event: FileChangeEvent) => void> = [];
  personal: Array<(event: FileChangeEvent) => void> = [];
  onFileChange(cb: (event: FileChangeEvent) => void) { this.shared.push(cb); }
  onPersonalChange(cb: (event: FileChangeEvent) => void) { this.personal.push(cb); }
  emit(event: FileChangeEvent) { for (const cb of this.shared) cb(event); }
}

let tmpRoot: string;
/** Merges the gateway started, so a test can wait for them. */
let merges: Promise<void>[];
const mergesDone = async () => {
  while (merges.length) await merges.shift();
};
let vault: string;
let storage: LocalFSAdapter;
let ot: OTService;
let files: FilesService;
let watcher: CapturingWatcher;
let gateway: OTGateway;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-ot-merge-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  mock.timers.reset();
});

beforeEach(async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  vault = path.join(tmpRoot, `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(vault, { recursive: true });
  storage = new LocalFSAdapter(vault);
  ot = new OTService(storage, { save: async () => undefined } as any, { trackChange: async () => undefined } as any);
  merges = [];
  const merge = ot.mergeExternalChange.bind(ot);
  ot.mergeExternalChange = (...args: Parameters<OTService['mergeExternalChange']>) => {
    const done = merge(...args);
    merges.push(done);
    return done;
  };
  files = new FilesService(storage);
  watcher = new CapturingWatcher();
  gateway = new OTGateway(
    ot,
    {} as any,
    watcher as any,
    files,
    { canCollab: () => true } as any,
    { visibilityFor: async () => ({ kind: 'owner' }) } as any,
    { record: () => undefined } as any,
    { findOrCreateForPath: async () => 'handle-1' } as any,
    { isUnlockedFor: async () => true } as any,
  );
});

/** Open `docId` on a socket and type `text` at `at` without letting it flush. */
async function openAndType(docId: string, text: string, at: number): Promise<FakeSocket> {
  const ws = fakeSocket();
  await gateway.handleDocOpen(ws as any, { docId });
  const length = ws.sent[0].content.length;
  const ops = [
    ...(at > 0 ? [{ type: 'retain', count: at }] : []),
    { type: 'insert', text },
    ...(length - at > 0 ? [{ type: 'retain', count: length - at }] : []),
  ];
  await gateway.handleOp(ws as any, { docId, ops, rev: 0 });
  ws.sent = [];
  return ws;
}

describe('OTGateway — another program edits an open note', () => {
  it('merges the disk change with unsaved edits, tells the clients, and saves both', async () => {
    await storage.write('n.md', 'top\nmiddle\nbottom\n');
    const ws = await openAndType('n.md', '!', 10); // "middle!", not flushed yet

    await fs.writeFile(path.join(vault, 'n.md'), 'top\nmiddle\nbottom\nadded in vim\n');
    watcher.emit({ event: 'change', path: 'n.md' });
    await mergesDone();

    const expected = 'top\nmiddle!\nbottom\nadded in vim\n';
    assert.equal(ot.sessionManager.getContent('n.md'), expected);
    assert.deepEqual(ws.sent.map((m) => m.type), ['op']);
    assert.equal(ws.sent[0].docId, 'n.md');
    assert.equal(ws.sent[0].rev, 2);

    mock.timers.tick(3_000); // the debounced flush
    await ot.sessionManager.flushNow('n.md'); // waits for it
    assert.equal(await storage.read('n.md'), expected);
  });

  it('leaves the session alone for its own flush echo', async () => {
    await storage.write('n.md', 'abc');
    const ws = await openAndType('n.md', 'd', 3);
    await ot.sessionManager.flushNow('n.md');
    ws.sent = [];

    watcher.emit({ event: 'change', path: 'n.md' });
    await mergesDone();

    assert.equal(ot.sessionManager.getContent('n.md'), 'abcd');
    assert.equal(ot.sessionManager.getRevision('n.md'), 1);
    assert.deepEqual(ws.sent, []);
  });
});

describe('OTGateway — a server-side write lands on disk under an open note', () => {
  it('merges it as an op instead of resetting the session and dropping its edits', async () => {
    await storage.write('n.md', 'first line\n');
    const ws = await openAndType('n.md', 'typed ', 0); // unsaved

    // A write that missed the live session (it went straight to disk).
    await storage.write('n.md', 'first line\nappended\n');
    files.emit('file:written', { path: 'n.md' });
    await mergesDone();

    assert.equal(ot.sessionManager.getContent('n.md'), 'typed first line\nappended\n');
    assert.deepEqual(ws.sent.map((m) => m.type), ['op'], 'an op, not a doc:reload');
  });
});
