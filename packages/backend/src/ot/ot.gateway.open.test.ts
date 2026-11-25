import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { FilesService } from '../files/files.service';
import { WrongKEKError, AADPathMismatchError } from '../crypto/envelope';
import { OTService } from './ot.service';
import { OTGateway } from './ot.gateway';

/** Paths whose reads fail with the given error, as a broken key or permission would. */
const unreadable = new Map<string, Error>();

class FlakyReadAdapter extends LocalFSAdapter {
  async read(filePath: string): Promise<string> {
    const error = unreadable.get(filePath);
    if (error) throw error;
    return super.read(filePath);
  }
}

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

const noopWatcher = { onFileChange() {}, onPersonalChange() {} } as any;

let tmpRoot: string;
let storage: LocalFSAdapter;
let ot: OTService;
let gateway: OTGateway;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-ot-open-'));
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
  unreadable.clear();
  storage = new FlakyReadAdapter(vault);
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

describe('OTGateway doc:open — paths that are not notes', () => {
  it('refuses a folder instead of starting a session whose flush would fail', async () => {
    await storage.write('Projects/plan.md', 'plan');
    const ws = fakeSocket();

    await gateway.handleDocOpen(ws as any, { docId: 'Projects' });

    assert.deepEqual(ws.sent, [{ type: 'error', code: 'not_found', docId: 'Projects' }]);
    assert.equal(ot.sessionManager.getSession('Projects'), undefined);
    assert.equal(ws.docId, undefined);
  });

  it('refuses a binary file', async () => {
    await storage.writeBytes!('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
    const ws = fakeSocket();

    await gateway.handleDocOpen(ws as any, { docId: 'photo.png' });

    assert.equal(ws.sent[0].code, 'not_found');
    assert.equal(ot.sessionManager.getSession('photo.png'), undefined);
  });

  // A read that fails for any reason but "no such file" used to open an empty
  // session, and the first keystroke flushed it over the real (encrypted) note.
  for (const [label, error] of [
    ['a wrong key', new WrongKEKError(Buffer.from('aa', 'hex'), Buffer.from('bb', 'hex'))],
    ['a tampered envelope', new AADPathMismatchError('Secret.md', 'Other.md')],
    ['a permission error', Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })],
  ] as const) {
    it(`refuses a note it can't read because of ${label}, and never writes over it`, async () => {
      await storage.write('Secret.md', 'the real note');
      unreadable.set('Secret.md', error);
      const ws = fakeSocket();

      await gateway.handleDocOpen(ws as any, { docId: 'Secret.md' });

      assert.deepEqual(ws.sent, [{ type: 'error', code: 'not_found', docId: 'Secret.md' }]);
      assert.equal(ot.sessionManager.getSession('Secret.md'), undefined);
      await gateway.handleOp(ws as any, { docId: 'Secret.md', ops: [{ type: 'insert', text: 'x' }], rev: 0 });
      mock.timers.tick(5 * 60_000);
      await new Promise((r) => setImmediate(r));
      unreadable.delete('Secret.md');
      assert.equal(await storage.read('Secret.md'), 'the real note');
    });
  }

  it('refuses a note whose read fails even when the path does not look present', async () => {
    // e.g. EACCES on a parent folder: `exists` says no, but it is not a new note.
    unreadable.set('Locked/n.md', Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
    const ws = fakeSocket();

    await gateway.handleDocOpen(ws as any, { docId: 'Locked/n.md' });

    assert.equal(ws.sent[0].code, 'not_found');
    assert.equal(ot.sessionManager.getSession('Locked/n.md'), undefined);
  });

  it('still opens a note, and a path with nothing on it as a new empty note', async () => {
    await storage.write('a.md', 'hello');
    const wa = fakeSocket();
    const wb = fakeSocket();

    await gateway.handleDocOpen(wa as any, { docId: 'a.md' });
    await gateway.handleDocOpen(wb as any, { docId: 'new.md' });

    assert.equal(wa.sent[0].type, 'doc:opened');
    assert.equal(wa.sent[0].content, 'hello');
    assert.equal(wb.sent[0].type, 'doc:opened');
    assert.equal(wb.sent[0].content, '');
  });
});
