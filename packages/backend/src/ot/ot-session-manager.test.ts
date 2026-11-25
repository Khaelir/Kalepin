import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { OTSessionManager } from './ot-session-manager';

const insert = (text: string, at: number, total: number) => [
  ...(at > 0 ? [{ type: 'retain' as const, count: at }] : []),
  { type: 'insert' as const, text },
  ...(total - at > 0 ? [{ type: 'retain' as const, count: total - at }] : []),
];

const fakeWs = () => ({}) as any;
const settle = () => new Promise((resolve) => setImmediate(resolve));

let manager: OTSessionManager;
let flushed: Array<{ docId: string; content: string }>;
let failWith: Error | null;
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  manager = new OTSessionManager();
  flushed = [];
  failWith = null;
  manager.setFlushHandler(async (docId, content) => {
    if (failWith) throw failWith;
    flushed.push({ docId, content });
  });
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  mock.timers.reset();
});

describe('OTSessionManager — failed final save', () => {
  // A failed close-time flush used to be an unhandled rejection, which exits
  // Node: any user could crash the server by editing a folder's doc id.
  it('a failed flush when the last client leaves neither rejects nor drops the edits', async () => {
    failWith = new Error('EISDIR: illegal operation on a directory');
    manager.getOrCreateSession('a.md', 'abc');
    const ws = fakeWs();
    manager.addClient('a.md', ws, 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('d', 3, 3), 0, 1);

    manager.removeClient('a.md', ws);
    await settle();
    await settle();

    assert.deepEqual(unhandled, []);
    const session = manager.getSession('a.md');
    assert.ok(session, 'the session holding unsaved edits is kept');
    assert.equal(session.content, 'abcd');
    assert.equal(session.dirty, true);
  });

  it('a failed flush on the inactivity close neither rejects nor drops the edits', async () => {
    failWith = new Error('ENOSPC: no space left on device');
    manager.getOrCreateSession('a.md', 'abc');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('d', 3, 3), 0, 1);

    mock.timers.tick(5 * 60_000);
    for (let i = 0; i < 5; i++) await settle();

    assert.deepEqual(unhandled, []);
    assert.equal(manager.getSession('a.md')?.content, 'abcd');
  });

  it('retries a failed flush on its own and saves once the disk recovers', async () => {
    failWith = new Error('ENOSPC: no space left on device');
    manager.getOrCreateSession('a.md', 'abc');
    const ws = fakeWs();
    manager.addClient('a.md', ws, 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('d', 3, 3), 0, 1);
    manager.removeClient('a.md', ws);
    await settle();
    await settle();

    failWith = null;
    mock.timers.tick(5_000);
    await settle();

    assert.deepEqual(flushed, [{ docId: 'a.md', content: 'abcd' }]);
    assert.equal(manager.getSession('a.md')?.dirty, false);
  });
});
