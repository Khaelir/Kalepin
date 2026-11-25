import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConflictException } from '@nestjs/common';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { FilesService } from '../files/files.service';
import { OTService } from './ot.service';
import { OTGateway } from './ot.gateway';

// FilesService writes (MCP patch_note, append_to_note, edit_note,
// restore_version, REST) read and wrote the disk copy of a note, which lags
// behind its live session: the file:written reset then threw away the
// editors' unsaved edits, base_hash was checked against stale content, and a
// debounced flush could land over the write. Writes to an open note now go
// through the session as an op.

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
let files: FilesService;
let gateway: OTGateway;
let tracked: Array<{ oldContent: string; newContent: string; userId: number | null }>;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-ot-server-writes-'));
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
  tracked = [];
  const changeTracking = {
    trackChange: async (_p: string, _a: string, oldContent: string, newContent: string, userId: number | null) => {
      tracked.push({ oldContent, newContent, userId });
    },
  };
  ot = new OTService(storage, { save: async () => undefined } as any, changeTracking as any);
  files = new FilesService(storage);
  gateway = new OTGateway(
    ot,
    {} as any,
    noopWatcher,
    files,
    { canCollab: () => true } as any,
    { visibilityFor: async () => ({ kind: 'owner' }) } as any,
    { record: () => undefined } as any,
    { findOrCreateForPath: async () => 'handle-1' } as any,
    { isUnlockedFor: async () => true } as any,
  );
});

/** Open `docId` and type `text` at `at`; the edit is acked but not on disk. */
async function openAndType(docId: string, text: string, at: number): Promise<FakeSocket> {
  const ws = fakeSocket();
  await gateway.handleDocOpen(ws as any, { docId });
  const length = ws.sent[0].content.length;
  await gateway.handleOp(ws as any, {
    docId,
    ops: [
      ...(at > 0 ? [{ type: 'retain', count: at }] : []),
      { type: 'insert', text },
      ...(length - at > 0 ? [{ type: 'retain', count: length - at }] : []),
    ],
    rev: 0,
  });
  ws.sent = [];
  return ws;
}

describe('FilesService writes to a note open in an editor', () => {
  it('patch_note keeps the unsaved edits and reaches the editor as an op', async () => {
    await storage.write('n.md', '# Plan\n\nstep one\n');
    const ws = await openAndType('n.md', ' (typed)', 6); // "# Plan (typed)"

    await files.patchFile('n.md', 'step one', 'step 1', undefined, 'alice@example.com');

    const expected = '# Plan (typed)\n\nstep 1\n';
    assert.equal(ot.sessionManager.getContent('n.md'), expected);
    assert.equal(await storage.read('n.md'), expected, 'saved right away');
    assert.ok(ws.sent.some((m) => m.type === 'op' && m.docId === 'n.md'), 'the editor gets an op');
    assert.ok(!ws.sent.some((m) => m.type === 'doc:reload'), 'no forced reload');
  });

  it('a client op sent before the write is transformed past it, not rejected', async () => {
    await storage.write('n.md', 'abc\n');
    const ws = fakeSocket();
    await gateway.handleDocOpen(ws as any, { docId: 'n.md' });

    await files.appendToFile('n.md', 'appended', '\n', undefined, 'alice@example.com');
    // Typed at revision 0, before the editor saw the append.
    await gateway.handleOp(ws as any, { docId: 'n.md', ops: [{ type: 'insert', text: '!' }, { type: 'retain', count: 4 }], rev: 0 });

    assert.equal(ot.sessionManager.getContent('n.md'), '!abc\n\nappended');
    assert.equal(ws.sent[ws.sent.length - 1].type, 'ack');
  });

  it('reads the live content, and checks base_hash against it', async () => {
    await storage.write('n.md', 'old\n');
    await openAndType('n.md', 'new ', 0);

    const live = await files.readFile('n.md', 'alice@example.com');
    assert.equal(live, 'new old\n');

    await assert.rejects(
      files.createFile('n.md', 'rewrite\n', 1, files.computeContentHash('old\n'), 'alice@example.com'),
      ConflictException,
      'a hash of the stale disk copy is a conflict',
    );
    await files.createFile('n.md', 'rewrite\n', 7, files.computeContentHash(live), 'alice@example.com');
    assert.equal(ot.sessionManager.getContent('n.md'), 'rewrite\n');
  });

  it('a pending debounced flush cannot land over the write', async () => {
    await storage.write('n.md', 'line\n');
    await openAndType('n.md', 'x', 0); // debounce armed with "xline\n"

    await files.appendToFile('n.md', 'tail', '', undefined, 'alice@example.com');
    mock.timers.tick(3_000);
    await ot.sessionManager.flushNow('n.md');

    assert.equal(await storage.read('n.md'), 'xline\ntail');
  });

  it('records the editor\'s edits and the server write as separate changes', async () => {
    await storage.write('n.md', 'a\n');
    await openAndType('n.md', 'typed ', 0); // by user 1

    await files.createFile('n.md', 'typed a\nfrom mcp\n', 7, undefined, 'alice@example.com');

    assert.deepEqual(tracked, [
      { oldContent: 'a\n', newContent: 'typed a\n', userId: 1 },
      { oldContent: 'typed a\n', newContent: 'typed a\nfrom mcp\n', userId: 7 },
    ]);
  });

  it('still writes a note nobody has open straight to disk', async () => {
    await storage.write('closed.md', 'one\n');

    await files.appendToFile('closed.md', 'two', '', undefined, 'alice@example.com');

    assert.equal(await storage.read('closed.md'), 'one\ntwo');
    assert.equal(ot.sessionManager.getSession('closed.md'), undefined);
  });
});
