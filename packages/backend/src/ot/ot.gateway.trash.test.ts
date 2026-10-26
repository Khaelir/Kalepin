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

// Trashing an open note must not let its live OT session re-create the file:
// the session is flushed into the trashed copy, dropped, and its clients told.

interface FakeSocket {
  readyState: number;
  docId?: string;
  sent: any[];
  send(data: string): void;
}

function fakeSocket(docId: string): FakeSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    docId,
    sent: [],
    send(data: string) { this.sent.push(JSON.parse(data)); },
  };
}

function last(ws: FakeSocket): any {
  return ws.sent[ws.sent.length - 1];
}

const noopWatcher ={ onFileChange() {}, onPersonalChange() {} } as any;

let tmpRoot: string;
let storage: LocalFSAdapter;
let ot: OTService;
let files: FilesService;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-ot-trash-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  mock.timers.reset();
});

beforeEach(async () => {
  // Session flush (3s) and inactivity (5min) timers.
  mock.timers.enable({ apis: ['setTimeout'] });
  const vault = path.join(tmpRoot, `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(vault, { recursive: true });
  storage = new LocalFSAdapter(vault);
  ot = new OTService(storage, { save: async () => undefined } as any, { trackChange: async () => undefined } as any);
  files = new FilesService(storage);
  // The gateway registers its move/trash hooks on FilesService.
  new OTGateway(
    ot,
    {} as any,
    noopWatcher,
    files,
    {} as any,
    {} as any,
    { record: () => undefined } as any,
    {} as any,
    {} as any,
  );
});

describe('OTGateway — trashing an open note', () => {
  it('flushes pending edits into the trashed copy, drops the session and notifies clients', async () => {
    await storage.write('Plan.md', 'hello');
    const ws = fakeSocket('Plan.md');
    await ot.openDocument('Plan.md', ws as any, 1, 'a@x.com');
    await ot.applyOperation('Plan.md', [{ type: 'retain', count: 5 }, { type: 'insert', text: ' world' }], 0, 1);

    await files.relocateForTrash('Plan.md', '.trash/abc/Plan.md', 'abc');

    assert.equal(await storage.read('.trash/abc/Plan.md'), 'hello world');
    assert.equal(await storage.exists('Plan.md'), false);
    assert.equal(ot.sessionManager.getSession('Plan.md'), undefined);
    assert.deepEqual(last(ws), { type: 'doc:trashed', docId: 'Plan.md', trashItemId: 'abc', trashedPath: 'Plan.md' });
    assert.equal(ws.docId, undefined);

    // A late op finds no session and is rejected; nothing re-creates the file.
    assert.equal(await ot.applyOperation('Plan.md', [{ type: 'insert', text: 'x' }], 1, 1), null);
    mock.timers.tick(5 * 60_000); // past the flush debounce and inactivity close
    await new Promise((r) => setImmediate(r));
    assert.equal(await storage.exists('Plan.md'), false);
  });

  it('writes edits that land after the pre-move flush straight to the trashed copy', async () => {
    await storage.write('Late.md', 'abc');
    const ws = fakeSocket('Late.md');
    await ot.openDocument('Late.md', ws as any, 1, 'a@x.com');
    // Registered after the gateway, so it runs after its pre-move flush.
    files.registerMoveHooks({
      beforeMove: async () => {
        await ot.applyOperation('Late.md', [{ type: 'retain', count: 3 }, { type: 'insert', text: 'd' }], 0, 1);
      },
    });

    await files.relocateForTrash('Late.md', '.trash/def/Late.md', 'def');

    assert.equal(await storage.read('.trash/def/Late.md'), 'abcd');
    assert.equal(await storage.exists('Late.md'), false);
  });

  it('drops every session under a trashed folder', async () => {
    await storage.write('Drafts/a.md', 'a');
    await storage.write('Drafts/sub/b.md', 'b');
    await storage.write('Other.md', 'o');
    const wa = fakeSocket('Drafts/a.md');
    const wb = fakeSocket('Drafts/sub/b.md');
    const wo = fakeSocket('Other.md');
    await ot.openDocument('Drafts/a.md', wa as any, 1, 'a@x.com');
    await ot.openDocument('Drafts/sub/b.md', wb as any, 1, 'a@x.com');
    await ot.openDocument('Other.md', wo as any, 1, 'a@x.com');

    await files.relocateForTrash('Drafts', '.trash/ghi/Drafts', 'ghi');

    assert.equal(ot.sessionManager.getSession('Drafts/a.md'), undefined);
    assert.equal(ot.sessionManager.getSession('Drafts/sub/b.md'), undefined);
    assert.ok(ot.sessionManager.getSession('Other.md'));
    assert.equal(last(wa).type, 'doc:trashed');
    assert.equal(last(wb).docId, 'Drafts/sub/b.md');
    assert.equal(last(wb).trashedPath, 'Drafts');
    assert.equal(wo.sent.length, 0);
    assert.equal(await storage.read('.trash/ghi/Drafts/sub/b.md'), 'b');
  });
});
