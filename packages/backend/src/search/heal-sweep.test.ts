import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { SearchService } from './search.service';

function stage1Predicates() {
  return {
    isEncryptedAtRest: () => false,
    isE2EEncrypted: () => false,
    shouldIndexPlaintext: () => true,
    canCollab: () => true,
    commentBodiesEncrypted: () => false,
    shareLinkMintable: () => true,
  };
}

function makeDs(): DataSource {
  return new DataSource({ type: 'better-sqlite3', database: ':memory:' });
}

class StubStorage {
  files = new Map<string, string>();
  mtimes = new Map<string, Date>();

  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) {
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return v;
  }
  async list(_dir: string): Promise<any[]> {
    return Array.from(this.files.keys()).map((p) => ({ path: p, type: 'file' }));
  }
  async stat(p: string): Promise<{ mtime: Date }> {
    const m = this.mtimes.get(p);
    if (!m) {
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return { mtime: m };
  }
  watch() { return { close: () => {} }; }
  setFile(p: string, content: string, mtime: Date) {
    this.files.set(p, content);
    this.mtimes.set(p, mtime);
  }
  unsetFile(p: string) {
    this.files.delete(p);
    this.mtimes.delete(p);
  }
}

class StubFileWatcher {
  onFileChange(_cb: any) {}
  onPersonalChange(_cb: any) {}
  onInternalWrite(_cb: any) {}
}

class StubSidecarService {
  async getThreadsForDocument(_p: string): Promise<any[]> { return []; }
}

class FakeEmbeddingService {
  get ready() { return true; }
  async onModuleInit() {}
  whenReady() { return Promise.resolve(); }
  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(768);
    for (let i = 0; i < text.length; i++) vec[text.charCodeAt(i) % 768] += 1;
    return vec;
  }
}

describe('SearchService — heal sweep', () => {
  let ds: DataSource;
  let storage: StubStorage;
  let service: SearchService;

  beforeEach(async () => {
    ds = makeDs();
    await ds.initialize();
    storage = new StubStorage();
    service = new SearchService(
      ds as any,
      storage as any,
      new StubFileWatcher() as any,
      new FakeEmbeddingService() as any,
      new StubSidecarService() as any,
      { trackSearch: () => {}, logFailedSearch: async () => {} } as any,
      stage1Predicates() as any,
    );
    storage.setFile('a.md', '# A', new Date('2026-01-01T00:00:00.000Z'));
    await service.onModuleInit();
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('reindexes a path whose disk mtime is newer than indexed_mtime', async () => {
    // Simulate drift: change file content + bump mtime on disk without going
    // through any indexer event.
    storage.setFile('a.md', '# A — drifted', new Date('2026-01-01T00:01:00.000Z'));

    const result = await service.healSweep();
    assert.equal(result.reindexed, 1);
    assert.equal(result.removed, 0);

    const rows = await ds.query(`SELECT title, content FROM notes_fts WHERE path = 'a.md'`);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].content.includes('drifted'));
  });

  it('removes index rows for paths that disappeared from disk', async () => {
    // Add a second file via reindex pathway, then delete it from "disk".
    storage.setFile('b.md', '# B', new Date('2026-01-01T00:00:00.000Z'));
    await service.reindexAll();

    storage.unsetFile('b.md');

    const result = await service.healSweep();
    assert.equal(result.removed >= 1, true);
    const rows = await ds.query(`SELECT path FROM notes_fts WHERE path = 'b.md'`);
    assert.equal(rows.length, 0);
    const meta = await ds.query(`SELECT path FROM notes_fts_meta WHERE path = 'b.md'`);
    assert.equal(meta.length, 0);
  });

  it('does nothing for a path whose indexed_mtime matches disk mtime', async () => {
    const result = await service.healSweep();
    assert.equal(result.reindexed, 0);
    assert.equal(result.removed, 0);
  });

  it('treats NULL indexed_mtime as drift and reindexes', async () => {
    await ds.query(`UPDATE notes_fts_meta SET indexed_mtime = NULL WHERE path = 'a.md'`);
    const result = await service.healSweep();
    assert.equal(result.reindexed, 1);

    const meta = await ds.query(`SELECT indexed_mtime FROM notes_fts_meta WHERE path = 'a.md'`);
    assert.equal(meta[0].indexed_mtime !== null, true);
  });
});
