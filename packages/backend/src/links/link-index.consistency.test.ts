import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { NoteLink } from '../entities';
import { LinkIndexService } from './link-index.service';

let ds: DataSource;
let svc: LinkIndexService;

beforeEach(async () => {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [NoteLink], synchronize: true });
  await ds.initialize();
  svc = new LinkIndexService(ds.getRepository(NoteLink), {} as any, ds, {} as any);
});

afterEach(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

const rows = () => ds.getRepository(NoteLink).find({ order: { id: 'ASC' } });

describe('LinkIndexService — index consistency', () => {
  it('stores each link once when a note is indexed twice at the same time', async () => {
    (svc as any).allPaths = ['plan.md', 'spec.md'];
    const content = '# Plan\nSee [[spec]] and [[spec#Goals]].';
    // A note write reaches the index through both the internal-write fast path and the watcher.
    await Promise.all([svc.indexFile('plan.md', content), svc.indexFile('plan.md', content), svc.indexFile('plan.md', content)]);
    assert.equal((await rows()).length, 2);
  });

  it('keeps the last update when updates of one note overlap', async () => {
    (svc as any).allPaths = ['plan.md', 'a.md', 'b.md'];
    await Promise.all([svc.indexFile('plan.md', '[[a]]'), svc.indexFile('plan.md', '[[b]]')]);
    assert.deepEqual((await rows()).map((r) => r.targetPath), ['b.md']);
  });

  it('resolves links written before their target note existed', async () => {
    (svc as any).allPaths = ['notes/plan.md'];
    await svc.indexFile('notes/plan.md', 'See [[Spec]] and [other](other.md).');
    assert.deepEqual((await rows()).map((r) => r.targetPath), [null, null]);

    (svc as any).allPaths.push('notes/spec.md');
    await svc.resolveLinksTo('notes/spec.md');
    assert.deepEqual((await rows()).map((r) => r.targetPath), ['notes/spec.md', null]);
    assert.deepEqual((await svc.getBacklinks('notes/spec.md')).map((b) => b.sourcePath), ['notes/plan.md']);

    (svc as any).allPaths.push('notes/other.md');
    await svc.resolveLinksTo('notes/other.md');
    assert.deepEqual((await rows()).map((r) => r.targetPath), ['notes/spec.md', 'notes/other.md']);
  });
});
