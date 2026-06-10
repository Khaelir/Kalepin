import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFile, moveFile, restoreVersion } from './api';
import { consumeSelfSaved } from './self-saved-paths';

// `markSelfSaved` is called synchronously, before the fetch is awaited. The
// regression we're guarding against was that `file:changed` echoes for a
// REST-initiated write would slip past `consumeSelfSaved` and surface as a
// "File changed externally" toast. The promise we hand back from `createFile`
// only resolves after fetch resolves; the test therefore inspects the
// registry while a deferred fetch is still pending.

interface DeferredFetchHandle {
  resolve: (res: Partial<Response>) => void;
  reject: (err: Error) => void;
  request: Promise<Response>;
}

function deferFetch(): DeferredFetchHandle {
  let resolveFn: (v: Partial<Response>) => void = () => {};
  let rejectFn: (err: Error) => void = () => {};
  const request = new Promise<Response>((res, rej) => {
    resolveFn = (v) => res(v as Response);
    rejectFn = rej;
  });
  return { resolve: resolveFn, reject: rejectFn, request };
}

beforeEach(() => {
  // Vitest runs node by default — stub localStorage so `authHeaders()` resolves.
  const store = new Map<string, string>([['kalepin_token', 'test']]);
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0,
  } as Storage;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selfSavedPaths registration before fetch resolves', () => {
  it('createFile registers the resolved path (with implicit .md) before the fetch settles', async () => {
    const handle = deferFetch();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(handle.request);

    const inFlight = createFile('Notes/quiet', '');
    // The path the watcher will fire on is `Notes/quiet.md` — server appends
    // the extension. Suppression must key off the resolved name.
    expect(consumeSelfSaved('Notes/quiet.md')).toBe(true);
    // Re-check: consumeSelfSaved deletes on success, so a second call returns false.
    expect(consumeSelfSaved('Notes/quiet.md')).toBe(false);

    handle.resolve({ ok: true, status: 200, json: async () => ({}) } as Partial<Response>);
    await inFlight;
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('createFile keeps an explicit `.md` path verbatim', async () => {
    const handle = deferFetch();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(handle.request);

    const inFlight = createFile('Notes/explicit.md', '');
    expect(consumeSelfSaved('Notes/explicit.md')).toBe(true);

    handle.resolve({ ok: true, status: 200, json: async () => ({}) } as Partial<Response>);
    await inFlight;
  });

  it('moveFile registers the destination before the fetch settles', async () => {
    const handle = deferFetch();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(handle.request);

    const inFlight = moveFile('Notes/old.md', 'Notes/new.md');
    expect(consumeSelfSaved('Notes/new.md')).toBe(true);
    expect(consumeSelfSaved('Notes/old.md')).toBe(false);

    handle.resolve({ ok: true, status: 200, json: async () => ({}) } as Partial<Response>);
    await inFlight;
  });

  it('restoreVersion registers the path before the fetch settles', async () => {
    const handle = deferFetch();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(handle.request);

    const inFlight = restoreVersion('Notes/foo.md', 42);
    expect(consumeSelfSaved('Notes/foo.md')).toBe(true);

    handle.resolve({ ok: true, status: 200, json: async () => ({}) } as Partial<Response>);
    await inFlight;
  });
});
