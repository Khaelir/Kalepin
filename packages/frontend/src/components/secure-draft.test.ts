import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecureDraft, type SaveState } from './secure-draft';

let writes: Array<[string, string]>;

function makeDraft(path: string, overrides: Partial<ConstructorParameters<typeof SecureDraft>[0]> = {}) {
  const states: SaveState[] = [];
  const draft = new SecureDraft({
    path,
    read: async (p) => `stored ${p}`,
    write: async (p, content) => { writes.push([p, content]); },
    onState: (s) => states.push(s),
    ...overrides,
  });
  return { draft, states };
}

describe('SecureDraft', () => {
  beforeEach(() => {
    writes = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves an edit to its own path after the debounce', async () => {
    const { draft, states } = makeDraft('_secure/a.md');
    draft.edit('hello');
    await vi.advanceTimersByTimeAsync(799);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([['_secure/a.md', 'hello']]);
    expect(states).toEqual(['dirty', 'saving', 'saved']);
  });

  it('writes nothing on ⌘S once the edit was saved', async () => {
    const { draft } = makeDraft('_secure/a.md');
    draft.edit('A text');
    await vi.advanceTimersByTimeAsync(800);
    await draft.flush();
    expect(writes).toEqual([['_secure/a.md', 'A text']]);
  });

  it("never writes one note's text into the next note opened", async () => {
    // Edit A, let it save, open B, press ⌘S before typing.
    const a = makeDraft('_secure/a.md').draft;
    a.edit('A text');
    await vi.advanceTimersByTimeAsync(800);
    await a.close();
    const b = makeDraft('_secure/b.md').draft;
    await b.load();
    await b.flush();
    expect(writes).toEqual([['_secure/a.md', 'A text']]);
  });

  it('saves pending edits to the note being left instead of dropping them', async () => {
    const a = makeDraft('_secure/a.md').draft;
    a.edit('last words');
    await vi.advanceTimersByTimeAsync(300); // switch notes before the debounce fires
    await a.close();
    expect(writes).toEqual([['_secure/a.md', 'last words']]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(1);
  });

  it('drops a read that comes back after the note was left', async () => {
    let finish!: (text: string) => void;
    const { draft } = makeDraft('_secure/a.md', {
      read: () => new Promise<string>((r) => { finish = r; }),
    });
    const loading = draft.load();
    await draft.close();
    finish('A text');
    await expect(loading).resolves.toBeNull();
  });

  it('drops a read superseded by a newer one', async () => {
    const resolvers: Array<(text: string) => void> = [];
    const { draft } = makeDraft('_secure/a.md', {
      read: () => new Promise<string>((r) => { resolvers.push(r); }),
    });
    const first = draft.load();
    const second = draft.load();
    resolvers[1]('new');
    resolvers[0]('old');
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBe('new');
  });

  it('ignores a read failure for a note already left', async () => {
    let fail!: (err: Error) => void;
    const { draft } = makeDraft('_secure/a.md', {
      read: () => new Promise<string>((_r, j) => { fail = j; }),
    });
    const loading = draft.load();
    await draft.close();
    fail(new Error('boom'));
    await expect(loading).resolves.toBeNull();
  });

  it('runs saves one at a time so the last edit sticks', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const { draft } = makeDraft('_secure/a.md', {
      write: (_p, content) => {
        order.push(`start ${content}`);
        if (content === 'one') {
          return new Promise<void>((r) => { releaseFirst = () => { order.push('end one'); r(); }; });
        }
        order.push(`end ${content}`);
        return Promise.resolve();
      },
    });
    draft.edit('one');
    await vi.advanceTimersByTimeAsync(800); // save of "one" in flight
    draft.edit('two');
    const closing = draft.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['start one']);
    releaseFirst();
    await closing;
    expect(order).toEqual(['start one', 'end one', 'start two', 'end two']);
  });

  it('reports no state after the note was left', async () => {
    const { draft, states } = makeDraft('_secure/a.md');
    draft.edit('x');
    states.length = 0;
    await draft.close();
    draft.edit('y');
    await vi.advanceTimersByTimeAsync(2000);
    expect(states).toEqual([]);
    expect(writes).toEqual([['_secure/a.md', 'x']]);
  });

  it('keeps the edit pending when the save fails, and retries on ⌘S', async () => {
    let fail = true;
    const errors: unknown[] = [];
    const { draft } = makeDraft('_secure/a.md', {
      write: async (p, content) => {
        if (fail) throw new Error('offline');
        writes.push([p, content]);
      },
      onState: (s, err) => { if (s === 'error') errors.push(err); },
    });
    draft.edit('kept');
    await vi.advanceTimersByTimeAsync(800);
    expect(errors).toHaveLength(1);
    fail = false;
    await draft.flush();
    expect(writes).toEqual([['_secure/a.md', 'kept']]);
  });
});
