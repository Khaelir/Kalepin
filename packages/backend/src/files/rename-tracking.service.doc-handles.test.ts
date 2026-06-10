import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { FileChangeEvent } from '@kalepin/shared';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { RenameTrackingService } from './rename-tracking.service';

class StubFileWatcher {
  cb: ((event: FileChangeEvent) => void) | null = null;
  onFileChange(cb: (event: FileChangeEvent) => void) {
    this.cb = cb;
  }
}

let ds: DataSource;
let repo: Repository<DocHandle>;
let docHandles: DocHandlesService;
let watcher: StubFileWatcher;
let service: RenameTrackingService;
const fileBodies = new Map<string, string>();

const stubChangeRepo = {
  createQueryBuilder: () => ({
    update: () => ({ set: () => ({ where: () => ({ execute: async () => undefined }) }) }),
    where: () => ({ getMany: async () => [] }),
  }),
  save: async () => undefined,
} as any;
const stubStarRepo = stubChangeRepo;
const stubShareLinks = {
  deleteByPath: async () => undefined,
  updatePath: async () => undefined,
  updatePathPrefix: async () => undefined,
} as any;
const stubGrants = {
  cascadeDelete: async () => undefined,
  cascadeRename: async () => undefined,
} as any;
const stubStorage = {
  read: async (p: string) => {
    const body = fileBodies.get(p);
    if (body === undefined) throw new Error(`ENOENT: ${p}`);
    return body;
  },
} as any;

beforeEach(async () => {
  fileBodies.clear();
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocHandle],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(DocHandle);
  docHandles = new DocHandlesService(repo);
  watcher = new StubFileWatcher();
  service = new RenameTrackingService(
    stubStorage,
    watcher as any,
    stubChangeRepo,
    stubStarRepo,
    stubShareLinks,
    stubGrants,
    docHandles,
  );
  service.onModuleInit();
});

afterEach(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('RenameTrackingService — doc handles', () => {
  it('external add for an unknown path mints a handle', async () => {
    fileBodies.set('Notes/External.md', 'body');
    watcher.cb!({ event: 'add', path: 'Notes/External.md' });
    // Mint runs as fire-and-forget after .findOrCreateForPath resolves.
    await wait(20);
    const id = await docHandles.forPath('Notes/External.md');
    assert.notEqual(id, null);
    assert.match(id!, /^[A-Z2-7]{16}$/);
  });

  it('external add for a path that already has a handle is a no-op', async () => {
    fileBodies.set('Notes/Foo.md', 'body');
    const original = await docHandles.findOrCreateForPath('Notes/Foo.md');
    watcher.cb!({ event: 'add', path: 'Notes/Foo.md' });
    await wait(20);
    const id = await docHandles.forPath('Notes/Foo.md');
    assert.equal(id, original);
  });

  it('external delete (after correlator window) tombstones the handle', async () => {
    fileBodies.set('Notes/Foo.md', 'body');
    const id = await docHandles.findOrCreateForPath('Notes/Foo.md');
    watcher.cb!({ event: 'unlink', path: 'Notes/Foo.md' });
    // setTimeout in onModuleInit waits 500ms.
    await wait(600);
    const result = await docHandles.resolve(id);
    assert.equal(result.tombstoned, true);
  });

  it('correlated rename pair preserves the handle id', async () => {
    fileBodies.set('Notes/Foo.md', 'body');
    const id = await docHandles.findOrCreateForPath('Notes/Foo.md');
    // Simulate a rename: chokidar emits unlink+add of identical content.
    watcher.cb!({ event: 'unlink', path: 'Notes/Foo.md' });
    fileBodies.delete('Notes/Foo.md');
    fileBodies.set('Notes/Bar.md', 'body');
    watcher.cb!({ event: 'add', path: 'Notes/Bar.md' });
    // Wait for the rename-correlator's debounce + the 500ms unlink-cleanup
    // window so the late tombstone path runs (and is suppressed by
    // recentlyRenamed).
    await wait(700);
    const result = await docHandles.resolve(id);
    assert.equal(result.tombstoned, false);
    assert.equal(result.path, 'Notes/Bar.md');
  });
});
