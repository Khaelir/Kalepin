import 'reflect-metadata';
import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { FileChangeEvent } from '@kalepin/shared';
import { RenameTrackingService } from './rename-tracking.service';
import { FileWatcherService } from './file-watcher.service';

/** Captures both subscriptions; the self-caused registry is the real one. */
class StubFileWatcher {
  shared: ((event: FileChangeEvent) => void) | null = null;
  personal: ((event: FileChangeEvent) => void) | null = null;
  readonly real = new FileWatcherService({} as any);
  onFileChange(cb: (event: FileChangeEvent) => void) { this.shared = cb; }
  onPersonalChange(cb: (event: FileChangeEvent) => void) { this.personal = cb; }
  isSelfRemoved(p: string) { return this.real.isSelfRemoved(p); }
  isSelfCaused(p: string) { return this.real.isSelfCaused(p); }
}

const noopRepo = {
  createQueryBuilder: () => ({
    update: () => ({ set: () => ({ where: () => ({ execute: async () => undefined }) }) }),
    where: () => ({ getMany: async () => [] }),
  }),
  save: async () => undefined,
} as any;

let calls: string[];
let tracked: Array<{ path: string; action: string; userId: unknown }>;
let onDisk: Set<string>;
let watcher: StubFileWatcher;

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  calls = [];
  tracked = [];
  onDisk = new Set();
  watcher = new StubFileWatcher();
  const storage = {
    read: async (p: string) => {
      if (!onDisk.has(p)) throw new Error(`ENOENT: ${p}`);
      return 'body';
    },
    exists: async (p: string) => onDisk.has(p),
  } as any;
  const shareLinks = {
    deleteByPath: async (p: string) => { calls.push(`share.delete:${p}`); },
    updatePath: async (a: string, b: string) => { calls.push(`share.rename:${a}->${b}`); },
    updatePathPrefix: async () => {},
  } as any;
  const grants = {
    cascadeDelete: async (p: string) => { calls.push(`grants.delete:${p}`); },
    cascadeRename: async () => {},
  } as any;
  const docHandles = {
    findOrCreateForPath: async (p: string) => { calls.push(`handle.mint:${p}`); return 'X'; },
    tombstoneByPath: async (p: string) => { calls.push(`handle.tombstone:${p}`); },
    updatePathByPath: async (a: string, b: string) => { calls.push(`handle.rename:${a}->${b}`); },
    updatePathPrefix: async () => {},
  } as any;
  const changeTracking = {
    trackChange: async (path: string, action: string, _o: unknown, _n: unknown, userId: unknown) => {
      tracked.push({ path, action, userId });
    },
  } as any;
  const service = new RenameTrackingService(
    storage,
    watcher as any,
    noopRepo,
    noopRepo,
    shareLinks,
    grants,
    docHandles,
    changeTracking,
  );
  service.onModuleInit();
});

describe('RenameTrackingService — removals Kalepin caused', () => {
  it('ignores the unlink of a trashed note: no cleanup, no change row', async () => {
    watcher.real.markSelfRemoved('Plan.md');
    watcher.shared!({ event: 'unlink', path: 'Plan.md' });
    await wait(600);
    assert.deepEqual(calls, []);
    assert.deepEqual(tracked, []);
  });

  it('ignores every file under a trashed folder', async () => {
    watcher.real.markSelfRemoved('Drafts');
    watcher.shared!({ event: 'unlink', path: 'Drafts/a.md' });
    watcher.shared!({ event: 'unlink', path: 'Drafts/sub/b.md' });
    await wait(600);
    assert.deepEqual(calls, []);
    assert.deepEqual(tracked, []);
  });

  it('does not pair a trash unlink with an unrelated add into a rename', async () => {
    watcher.real.markSelfRemoved('Gone.md');
    watcher.shared!({ event: 'unlink', path: 'Gone.md' });
    onDisk.add('Fresh.md');
    watcher.shared!({ event: 'add', path: 'Fresh.md' });
    await wait(600);
    assert.ok(!calls.some((c) => c.startsWith('handle.rename:')), calls.join(','));
    assert.ok(calls.includes('handle.mint:Fresh.md'));
  });

  it('ignores the add of a restored note (no mint race, no pairing)', async () => {
    watcher.real.markSelfRemoved('Back.md');
    onDisk.add('Back.md');
    watcher.shared!({ event: 'add', path: 'Back.md' });
    await wait(50);
    assert.deepEqual(calls, []);
  });

  it('does not record a delete for the source of a cross-zone move', async () => {
    watcher.real.markSelfMoved('Moved.md');
    watcher.shared!({ event: 'unlink', path: 'Moved.md' });
    await wait(600);
    assert.deepEqual(tracked, []);
    // Cleanup still runs as before (a no-op: FilesService.move re-pathed the rows).
    assert.ok(calls.includes('share.delete:Moved.md'));
  });
});

describe('RenameTrackingService — external deletes', () => {
  it('records a deleted change for a note removed by another program', async () => {
    watcher.shared!({ event: 'unlink', path: 'notes/x.md' });
    await wait(600);
    assert.deepEqual(tracked, [{ path: 'notes/x.md', action: 'deleted', userId: null }]);
    assert.ok(calls.includes('handle.tombstone:notes/x.md'));
  });

  it('records nothing when the unlink is half of a rename', async () => {
    watcher.shared!({ event: 'unlink', path: 'old.md' });
    onDisk.add('new.md');
    watcher.shared!({ event: 'add', path: 'new.md' });
    await wait(600);
    assert.deepEqual(tracked, []);
    assert.ok(calls.includes('handle.rename:old.md->new.md'));
  });

  it('records nothing when the file is back (atomic save as unlink + add)', async () => {
    watcher.shared!({ event: 'unlink', path: 'saved.md' });
    onDisk.add('saved.md');
    watcher.shared!({ event: 'add', path: 'saved.md' });
    await wait(600);
    assert.deepEqual(tracked, []);
  });

  it('destroys nothing when the file is back: share links, grants and handle survive an atomic save', async () => {
    onDisk.add('kept.md');
    watcher.shared!({ event: 'unlink', path: 'kept.md' });
    watcher.shared!({ event: 'change', path: 'kept.md' });
    await wait(600);
    assert.deepEqual(calls, []);
    assert.deepEqual(tracked, []);
  });

  it('a removal Kalepin caused on a folder does not swallow events of look-alike siblings', async () => {
    watcher.real.markSelfRemoved('Drafts');
    watcher.shared!({ event: 'unlink', path: 'Drafts 2/x.md' });
    watcher.shared!({ event: 'unlink', path: 'Drafts.md' });
    await wait(600);
    assert.deepEqual(
      tracked.map((t) => t.path).sort(),
      ['Drafts 2/x.md', 'Drafts.md'],
    );
  });

  it('ignores non-markdown files', async () => {
    watcher.shared!({ event: 'unlink', path: 'pic.png' });
    await wait(600);
    assert.deepEqual(tracked, []);
  });

  it('records personal deletes too, but not personal renames or E2E paths', async () => {
    watcher.personal!({ event: 'unlink', path: '_users/a@x.com/gone.md' });
    watcher.personal!({ event: 'unlink', path: '_users/a@x.com/_secure/diary.md' });
    await wait(600);
    watcher.personal!({ event: 'unlink', path: '_users/a@x.com/old.md' });
    onDisk.add('_users/a@x.com/new.md');
    watcher.personal!({ event: 'add', path: '_users/a@x.com/new.md' });
    await wait(600);
    assert.deepEqual(tracked, [{ path: '_users/a@x.com/gone.md', action: 'deleted', userId: null }]);
    // Personal events still don't drive share-link / grant / handle cleanup.
    assert.deepEqual(calls, []);
  });
});
