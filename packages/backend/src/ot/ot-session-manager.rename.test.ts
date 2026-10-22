import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { OTSessionManager } from './ot-session-manager';

// A renamed doc must keep its live session, and every later flush must write
// to the new path. Before this, the session stayed keyed by the old path and
// its pending flush recreated the old file.

const insert = (text: string, at: number, total: number) => [
  ...(at > 0 ? [{ type: 'retain' as const, count: at }] : []),
  { type: 'insert' as const, text },
  ...(total - at > 0 ? [{ type: 'retain' as const, count: total - at }] : []),
];

const fakeWs = () => ({}) as any;

let manager: OTSessionManager;
let flushed: Array<{ docId: string; content: string }>;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  manager = new OTSessionManager();
  flushed = [];
  manager.setFlushHandler(async (docId, content) => {
    flushed.push({ docId, content });
  });
});

afterEach(() => {
  mock.timers.reset();
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('OTSessionManager.renameSession', () => {
  it('re-keys the session and keeps its content and revision', () => {
    manager.getOrCreateSession('a.md', 'hello');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('!', 5, 5), 0, 1);

    assert.deepEqual(manager.renameSession('a.md', 'b.md'), { displaced: [] });
    assert.equal(manager.getSession('a.md'), undefined);
    const session = manager.getSession('b.md')!;
    assert.equal(session.docId, 'b.md');
    assert.equal(session.content, 'hello!');
    assert.equal(session.revision, 1);
    assert.equal(session.clients.size, 1);
  });

  it('a flush pending at rename time writes to the new path, never the old one', async () => {
    manager.getOrCreateSession('a.md', 'hello');
    manager.addClient('a.md', fakeWs(), 1, 'alice@example.com');
    manager.applyOperation('a.md', insert('!', 5, 5), 0, 1);

    manager.renameSession('a.md', 'b.md');
    mock.timers.tick(3_000);
    await settle();

    assert.deepEqual(flushed, [{ docId: 'b.md', content: 'hello!' }]);
  });

  it('returns null when there is no session at the old id', () => {
    assert.equal(manager.renameSession('missing.md', 'b.md'), null);
  });

  it('replaces a session already open at the new id and returns its clients', () => {
    const phantomClient = fakeWs();
    manager.getOrCreateSession('b.md', '');
    manager.addClient('b.md', phantomClient, 2, 'bob@example.com');
    manager.getOrCreateSession('a.md', 'hello');

    const result = manager.renameSession('a.md', 'b.md');
    assert.deepEqual(result?.displaced, [phantomClient]);
    assert.equal(manager.getSession('b.md')!.content, 'hello');
  });
});

describe('OTSessionManager.sessionIdsAtOrUnder', () => {
  it('matches the path itself and descendants, not siblings sharing a prefix', () => {
    for (const id of ['Notes', 'Notes/a.md', 'Notes/sub/b.md', 'Notes2/c.md', 'other.md']) {
      manager.getOrCreateSession(id, '');
    }
    assert.deepEqual(manager.sessionIdsAtOrUnder('Notes').sort(), ['Notes', 'Notes/a.md', 'Notes/sub/b.md']);
  });
});
