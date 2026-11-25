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

describe('OTSessionManager — edits made while a flush is writing', () => {
  /** A flush handler whose writes complete only when released, in any order. */
  function holdWrites() {
    const writes: Array<{ content: string; release: () => void }> = [];
    const done: string[] = [];
    manager.setFlushHandler((_docId, content) => new Promise<void>((resolve) => {
      writes.push({ content, release: () => { done.push(content); resolve(); } });
    }));
    return { writes, done };
  }

  it('saves an edit typed while the previous save was in flight', async () => {
    const { writes, done } = holdWrites();
    manager.getOrCreateSession('a.md', 'abc');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('d', 3, 3), 0, 1);
    mock.timers.tick(3_000); // debounce fires: writing "abcd"
    await settle();
    manager.applyOperation('a.md', insert('e', 4, 4), 1, 1); // typed meanwhile
    writes[0].release();
    await settle();

    assert.equal(manager.getSession('a.md')!.dirty, true, 'the second edit is not on disk yet');
    mock.timers.tick(3_000);
    await settle();
    writes[1]?.release();
    await settle();

    assert.deepEqual(done, ['abcd', 'abcde']);
    assert.equal(manager.getSession('a.md')!.dirty, false);
  });

  it('never lets an older write land after a newer one', async () => {
    const { writes, done } = holdWrites();
    manager.getOrCreateSession('a.md', 'abc');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('d', 3, 3), 0, 1);
    const first = manager.flushNow('a.md');
    await settle();
    manager.applyOperation('a.md', insert('e', 4, 4), 1, 1);
    const second = manager.flushNow('a.md');
    await settle();

    assert.equal(writes.length, 1, 'the second flush waits for the first write');
    writes[0].release();
    await first;
    await settle();
    writes[1].release();
    await second;

    assert.deepEqual(done, ['abcd', 'abcde']);
  });
});

describe('OTSessionManager — continuous typing', () => {
  // The 3 s debounce restarted on every op with no upper bound, so nothing
  // reached the disk while someone kept typing.
  it('flushes at least every 15 s while edits keep coming', () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    manager.getOrCreateSession('a.md', '');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');

    for (let i = 0; i < 15; i++) {
      manager.applyOperation('a.md', insert('x', i, i), i, 1);
      mock.timers.tick(1_000);
    }
    assert.equal(flushed.length, 1, 'one flush after 15 s of non-stop typing');
    assert.equal(flushed[0].content, 'x'.repeat(15));
  });

  it('still waits for 3 s of inactivity in the common case', async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    manager.getOrCreateSession('a.md', '');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('x', 0, 0), 0, 1);
    mock.timers.tick(2_999);
    assert.equal(flushed.length, 0);
    mock.timers.tick(1);
    await settle();
    assert.equal(flushed.length, 1);
  });
});

describe('OTSessionManager.mergeFromDisk', () => {
  it('applies a disk change to a session with no unsaved edits', async () => {
    const session = manager.getOrCreateSession('a.md', 'one\ntwo\n');
    const result = await manager.mergeFromDisk('a.md', async () => 'one\ntwo\nthree\n');

    assert.ok(result);
    assert.equal(session.content, 'one\ntwo\nthree\n');
    assert.equal(session.revision, 1);
    assert.equal(session.dirty, false, 'the merged content is what is on disk');
  });

  it('keeps unsaved edits and the disk change, and saves the merge', async () => {
    const session = manager.getOrCreateSession('a.md', 'top\nmiddle\nbottom\n');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('!', 10, 18), 0, 1); // "middle!", not saved yet

    await manager.mergeFromDisk('a.md', async () => 'TOP\nmiddle\nbottom\n');

    assert.equal(session.content, 'TOP\nmiddle!\nbottom\n');
    assert.equal(session.dirty, true);
    mock.timers.tick(3_000);
    await settle();
    assert.deepEqual(flushed, [{ docId: 'a.md', content: 'TOP\nmiddle!\nbottom\n' }]);
  });

  it('transforms a client op made before the merge past it', async () => {
    const session = manager.getOrCreateSession('a.md', 'abc\n');
    await manager.mergeFromDisk('a.md', async () => 'xyz\nabc\n');
    // Sent at revision 0, before the client saw the merge.
    assert.ok(manager.applyOperation('a.md', insert('!', 3, 4), 0, 1));
    assert.equal(session.content, 'xyz\nabc!\n');
  });

  it('ignores a file that holds what the session last saved (its own write)', async () => {
    const session = manager.getOrCreateSession('a.md', 'abc');
    manager.applyOperation('a.md', insert('d', 3, 3), 0, 1);
    await manager.flushNow('a.md');

    assert.equal(await manager.mergeFromDisk('a.md', async () => 'abcd'), null);
    assert.equal(session.revision, 1);
  });

  it('never takes a write of its own that is still landing for an outside change', async () => {
    let finishWrite: (() => void) | undefined;
    manager.setFlushHandler(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const session = manager.getOrCreateSession('a.md', 'abc');
    manager.applyOperation('a.md', insert('d', 3, 3), 0, 1);
    const flushing = manager.flushNow('a.md');
    await settle();

    // A read during the write would see a truncated file.
    let disk = 'ab';
    const merging = manager.mergeFromDisk('a.md', async () => disk);
    disk = 'abcd';
    finishWrite!();
    await flushing;
    const result = await merging;

    assert.equal(result, null);
    assert.equal(session.content, 'abcd');
  });
});

describe('OTSessionManager — closing while a client comes back', () => {
  // The "did a client re-join?" check ran before the close handler (git
  // commit, embedding drain), and the session was deleted after it anyway:
  // a client that re-joined in between edited an orphan whose ops were all
  // rejected.
  it('keeps the session a client re-joins while the close handler runs', async () => {
    let finishClose: (() => void) | undefined;
    manager.setSessionCloseHandler(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    const session = manager.getOrCreateSession('a.md', 'abc');
    const ws = fakeWs();
    manager.addClient('a.md', ws, 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('d', 3, 3), 0, 1);

    manager.removeClient('a.md', ws); // switches to another note...
    await settle();
    assert.ok(finishClose, 'final flush done, close handler running');

    const again = manager.getOrCreateSession('a.md', 'from disk'); // ...and comes back
    manager.addClient('a.md', ws, 1, 'alice@example.com');
    assert.equal(again, session);
    finishClose!();
    await settle();

    assert.equal(manager.getSession('a.md'), session, 'the re-joined session is still the live one');
    assert.ok(manager.applyOperation('a.md', insert('Z', 0, 4), session.revision, 1));
    assert.equal(session.content, 'Zabcd');
  });

  it('still deletes the session when nobody came back', async () => {
    let closed = 0;
    manager.setSessionCloseHandler(async () => { closed++; });
    manager.getOrCreateSession('a.md', 'abc');
    const ws = fakeWs();
    manager.addClient('a.md', ws, 1, 'alice@example.com');

    manager.removeClient('a.md', ws);
    await settle();

    assert.equal(closed, 1);
    assert.equal(manager.getSession('a.md'), undefined);
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
