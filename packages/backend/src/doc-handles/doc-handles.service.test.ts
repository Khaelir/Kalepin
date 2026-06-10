import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService, generateHandleId } from './doc-handles.service';
import { NotFoundException } from '@nestjs/common';

let ds: DataSource;
let repo: Repository<DocHandle>;
let service: DocHandlesService;

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DocHandle],
    synchronize: true,
  });
  await ds.initialize();
  repo = ds.getRepository(DocHandle);
  service = new DocHandlesService(repo);
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

describe('generateHandleId', () => {
  it('emits a 16-char base32 (A-Z2-7) string', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateHandleId();
      assert.equal(id.length, 16);
      assert.match(id, /^[A-Z2-7]{16}$/);
    }
  });

  it('is non-deterministic across calls', () => {
    const a = generateHandleId();
    const b = generateHandleId();
    assert.notEqual(a, b);
  });
});

describe('DocHandlesService.findOrCreateForPath', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('mints a new id on first call for an unknown path', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    assert.match(id, /^[A-Z2-7]{16}$/);
    const row = await repo.findOneOrFail({ where: { path: 'Notes/Foo.md' } });
    assert.equal(row.id, id);
    assert.equal(row.tombstoneAt, null);
  });

  it('is idempotent — returns the same id on re-mint', async () => {
    const id1 = await service.findOrCreateForPath('Notes/Foo.md');
    const id2 = await service.findOrCreateForPath('Notes/Foo.md');
    assert.equal(id1, id2);
    const rows = await repo.find({ where: { path: 'Notes/Foo.md' } });
    assert.equal(rows.length, 1);
  });

  it('reactivates a tombstoned row when the path matches (backup-restore corner)', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    await service.tombstone(id);
    const id2 = await service.findOrCreateForPath('Notes/Foo.md');
    assert.equal(id, id2);
    const row = await repo.findOneOrFail({ where: { id } });
    assert.equal(row.tombstoneAt, null);
  });
});

describe('DocHandlesService.forPath', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns null when no row exists', async () => {
    assert.equal(await service.forPath('Notes/Foo.md'), null);
  });

  it('returns the id when a row exists (no mint side-effect)', async () => {
    const minted = await service.findOrCreateForPath('Notes/Foo.md');
    assert.equal(await service.forPath('Notes/Foo.md'), minted);
  });
});

describe('DocHandlesService.resolve', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns { path, tombstoned: false } for an active id', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    const result = await service.resolve(id);
    assert.deepEqual(result, { path: 'Notes/Foo.md', tombstoned: false });
  });

  it('returns { path, tombstoned: true } for a tombstoned id', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    await service.tombstone(id);
    const result = await service.resolve(id);
    assert.equal(result.path, 'Notes/Foo.md');
    assert.equal(result.tombstoned, true);
  });

  it('throws NotFoundException for an unknown id', async () => {
    await assert.rejects(
      () => service.resolve('NOTAREALHANDLE2X'),
      (err) => err instanceof NotFoundException,
    );
  });
});

describe('DocHandlesService.updatePath', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('updates the path while preserving the id (rename / move)', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    await service.updatePath(id, 'Notes/Bar.md');
    const result = await service.resolve(id);
    assert.deepEqual(result, { path: 'Notes/Bar.md', tombstoned: false });
  });

  it('updatePathByPath rewrites the matching row', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    await service.updatePathByPath('Notes/Foo.md', 'Archive/Foo.md');
    const result = await service.resolve(id);
    assert.equal(result.path, 'Archive/Foo.md');
  });
});

describe('DocHandlesService.tombstone', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('stamps tombstoneAt without removing the row', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    await service.tombstone(id);
    const row = await repo.findOneOrFail({ where: { id } });
    assert.notEqual(row.tombstoneAt, null);
    assert.ok(typeof row.tombstoneAt === 'number');
  });

  it('tombstoneByPath stamps tombstoneAt on the matching row', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    await service.tombstoneByPath('Notes/Foo.md');
    const row = await repo.findOneOrFail({ where: { id } });
    assert.notEqual(row.tombstoneAt, null);
  });

  it('untombstone clears tombstoneAt', async () => {
    const id = await service.findOrCreateForPath('Notes/Foo.md');
    await service.tombstone(id);
    await service.untombstone(id);
    const row = await repo.findOneOrFail({ where: { id } });
    assert.equal(row.tombstoneAt, null);
  });
});
