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

describe('OTSessionManager — revisions kept for transforms', () => {
  // History was read at the absolute revision, but a reset empties it and a
  // flush trims it to 1000 ops: every concurrent op then came back null
  // ("Operation rejected") and the client threw its pending edits away.
  it('transforms concurrent ops made after a reset', () => {
    const session = manager.getOrCreateSession('a.md', 'hello');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');
    manager.resetContent('a.md', 'hello world');
    const rev = session.revision;

    const first = manager.applyOperation('a.md', insert('A', 0, 11), rev, 1);
    const concurrent = manager.applyOperation('a.md', insert('B', 11, 11), rev, 2);

    assert.ok(first);
    assert.ok(concurrent, 'a concurrent op at the post-reset revision is transformed, not rejected');
    assert.equal(session.content, 'Ahello worldB');
  });

  it('transforms concurrent ops once more than 1000 ops were trimmed by a flush', async () => {
    const session = manager.getOrCreateSession('b.md', '');
    manager.addClient('b.md', fakeWs(), 1, 'alice@example.com');
    for (let i = 0; i < 1001; i++) manager.applyOperation('b.md', insert('x', i, i), i, 1);
    await manager.flushNow('b.md');

    const first = manager.applyOperation('b.md', insert('y', 1001, 1001), 1001, 1);
    const concurrent = manager.applyOperation('b.md', insert('z', 0, 1001), 1001, 2);
    // The flush kept the last 1000 of 1001 ops: revision 0 is gone.
    const tooOld = manager.applyOperation('b.md', insert('w', 0, 0), 0, 2);

    assert.ok(first);
    assert.ok(concurrent, 'a concurrent op at a kept revision is transformed, not rejected');
    assert.equal(session.content, 'z' + 'x'.repeat(1001) + 'y');
    assert.equal(tooOld, null, 'an op older than the kept window is still rejected');
  });

  it('rejects ops from a revision the session never had', () => {
    manager.getOrCreateSession('c.md', 'abc');
    assert.equal(manager.applyOperation('c.md', insert('x', 0, 3), 5, 1), null);
    assert.equal(manager.applyOperation('c.md', insert('x', 0, 3), undefined as any, 1), null);
    assert.equal(manager.getSession('c.md')!.content, 'abc');
  });
});
