import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { FileWatcherService } from './file-watcher.service';
import { FileChangeEvent } from '@kalepin/shared';

class StubStorage {
  stats = new Map<string, Date>();
  watchCb: ((event: FileChangeEvent) => void) | null = null;
  watch(cb: (event: FileChangeEvent) => void) {
    this.watchCb = cb;
  }
  async stat(p: string): Promise<{ mtime: Date }> {
    const m = this.stats.get(p);
    if (!m) {
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return { mtime: m };
  }
}

describe('FileWatcherService — internal-write channel', () => {
  let storage: StubStorage;
  let service: FileWatcherService;

  beforeEach(() => {
    storage = new StubStorage();
    service = new FileWatcherService(storage as any);
    service.onModuleInit();
  });

  it('emitInternalWrite delivers (path, content) to internal-write subscribers only', async () => {
    const internalCalls: Array<{ path: string; content: string }> = [];
    const chokidarCalls: FileChangeEvent[] = [];
    service.onInternalWrite((p, c) => {
      internalCalls.push({ path: p, content: c });
    });
    service.onFileChange((ev) => chokidarCalls.push(ev));

    service.emitInternalWrite('notes/foo.md', 'hello');
    assert.deepEqual(internalCalls, [{ path: 'notes/foo.md', content: 'hello' }]);
    assert.equal(chokidarCalls.length, 0);
  });

  it('chokidar event matching dedup (same mtime within TTL) is suppressed', async () => {
    const events: FileChangeEvent[] = [];
    service.onFileChange((ev) => events.push(ev));

    const mtime = new Date('2026-01-01T00:00:00.000Z');
    storage.stats.set('notes/foo.md', mtime);
    service.markRecentInternalWrite('notes/foo.md', mtime);

    storage.watchCb!({ event: 'change', path: 'notes/foo.md' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(events.length, 0, 'matching mtime must suppress');
  });

  it('chokidar event with different mtime passes through (external writer)', async () => {
    const events: FileChangeEvent[] = [];
    service.onFileChange((ev) => events.push(ev));

    const internalMtime = new Date('2026-01-01T00:00:00.000Z');
    const externalMtime = new Date('2026-01-01T00:00:00.500Z');
    storage.stats.set('notes/foo.md', externalMtime);
    service.markRecentInternalWrite('notes/foo.md', internalMtime);

    storage.watchCb!({ event: 'change', path: 'notes/foo.md' });
    // Wait for async dispatch.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(events.length, 1, 'differing mtime must NOT suppress');
  });

  it('atomic-write unlink leg is suppressed within TTL', async () => {
    const events: FileChangeEvent[] = [];
    service.onFileChange((ev) => events.push(ev));

    const mtime = new Date('2026-01-01T00:00:00.000Z');
    storage.stats.set('notes/foo.md', mtime);
    service.markRecentInternalWrite('notes/foo.md', mtime);

    storage.watchCb!({ event: 'unlink', path: 'notes/foo.md' });
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(events.length, 0, 'unlink leg of atomic-rename must be suppressed');
  });

  it('dedup window expires after TTL', async () => {
    const events: FileChangeEvent[] = [];
    service.onFileChange((ev) => events.push(ev));

    const mtime = new Date('2026-01-01T00:00:00.000Z');
    storage.stats.set('notes/foo.md', mtime);

    // Insert with a TTL of 0 ms by reaching past expiry: mark, then wait 1100 ms.
    service.markRecentInternalWrite('notes/foo.md', mtime);
    assert.equal(service.hasDedupEntry('notes/foo.md'), true);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(service.hasDedupEntry('notes/foo.md'), false);

    storage.watchCb!({ event: 'change', path: 'notes/foo.md' });
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(events.length, 1, 'after TTL the chokidar event passes through');
  });

  it('non-deduped chokidar events are delivered immediately', async () => {
    const events: FileChangeEvent[] = [];
    service.onFileChange((ev) => events.push(ev));

    storage.watchCb!({ event: 'add', path: 'notes/external.md' });
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    assert.equal(events.length, 1);
    assert.equal(events[0].path, 'notes/external.md');
  });
});
