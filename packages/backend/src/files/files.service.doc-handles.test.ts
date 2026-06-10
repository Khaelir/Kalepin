import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DataSource, Repository } from 'typeorm';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from './files.service';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles/doc-handles.service';

const ALICE = 'alice@example.com';

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let routing: RoutingStorageAdapter;
let ds: DataSource;
let repo: Repository<DocHandle>;
let docHandles: DocHandlesService;
let service: FilesService;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-files-handles-'));
  sharedRoot = path.join(tmpRoot, 'vault');
  personalRoot = path.join(tmpRoot, 'personal');
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  routing = new RoutingStorageAdapter(
    new LocalFSAdapter(sharedRoot),
    new LocalFSAdapter(personalRoot),
  );
  await routing.ensurePersonalFolder(ALICE);

  if (ds?.isInitialized) await ds.destroy();
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocHandle],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(DocHandle);
  docHandles = new DocHandlesService(repo);

  service = new FilesService(
    routing as any,
    undefined, // changeTracking
    undefined, // linkIndex
    undefined, // dailyStatsService
    undefined, // shareLinks
    undefined, // attachments
    undefined, // visibility
    undefined, // grants
    undefined, // fileWatcher
    docHandles,
  );
});

async function flushAsync(): Promise<void> {
  // FilesService schedules doc-handle work on the .catch path after the disk
  // operation. Yield twice: once for the promise that started the call, once
  // for the inner await chain.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('FilesService doc-handles wiring', () => {
  it('createFile mints a handle for the new path', async () => {
    await service.createFile('Notes/Foo.md', 'hello', undefined, undefined, ALICE);
    await flushAsync();
    const id = await docHandles.forPath('Notes/Foo.md');
    assert.notEqual(id, null);
    assert.match(id!, /^[A-Z2-7]{16}$/);
  });

  it('createFile twice for the same path is idempotent', async () => {
    await service.createFile('Notes/Foo.md', 'a', undefined, undefined, ALICE);
    await flushAsync();
    const id1 = await docHandles.forPath('Notes/Foo.md');
    await service.createFile('Notes/Foo.md', 'b', undefined, undefined, ALICE);
    await flushAsync();
    const id2 = await docHandles.forPath('Notes/Foo.md');
    assert.equal(id1, id2);
  });

  it('deleteFile tombstones the matching handle', async () => {
    await service.createFile('Notes/Foo.md', 'x', undefined, undefined, ALICE);
    await flushAsync();
    const id = await docHandles.forPath('Notes/Foo.md');
    assert.notEqual(id, null);
    await service.deleteFile('Notes/Foo.md', undefined, ALICE);
    await flushAsync();
    const result = await docHandles.resolve(id!);
    assert.equal(result.tombstoned, true);
    assert.equal(result.path, 'Notes/Foo.md');
  });

  it('move preserves the handle id, updates the path', async () => {
    await service.createFile('Notes/Foo.md', 'x', undefined, undefined, ALICE);
    await flushAsync();
    const id = await docHandles.forPath('Notes/Foo.md');
    await service.move('Notes/Foo.md', 'Notes/Bar.md', ALICE);
    const result = await docHandles.resolve(id!);
    assert.equal(result.tombstoned, false);
    assert.equal(result.path, 'Notes/Bar.md');
  });

  it('folder rename rewrites contained handle paths', async () => {
    await service.createFile('Old/A.md', 'a', undefined, undefined, ALICE);
    await service.createFile('Old/B.md', 'b', undefined, undefined, ALICE);
    await flushAsync();
    const idA = await docHandles.forPath('Old/A.md');
    const idB = await docHandles.forPath('Old/B.md');
    await service.move('Old', 'New', ALICE);
    const a = await docHandles.resolve(idA!);
    const b = await docHandles.resolve(idB!);
    assert.equal(a.path, 'New/A.md');
    assert.equal(b.path, 'New/B.md');
  });
});
