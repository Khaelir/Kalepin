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

class CountingStorage {
  files = new Map<string, string>();
  mtimes = new Map<string, Date>();
  readCalls: string[] = [];

  async read(p: string): Promise<string> {
    this.readCalls.push(p);
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  }
  async list(_dir: string): Promise<any[]> {
    return Array.from(this.files.keys()).map((p) => ({ path: p, type: 'file' }));
  }
  async stat(p: string): Promise<{ mtime: Date }> {
    const m = this.mtimes.get(p);
    if (!m) throw new Error(`ENOENT: ${p}`);
    return { mtime: m };
  }
  watch() {}
  setFile(p: string, content: string) {
    this.files.set(p, content);
    this.mtimes.set(p, new Date());
  }
}

class StubFileWatcher {
  internalCallbacks: Array<(path: string, content: string) => void | Promise<void>> = [];
  onFileChange(_cb: any) {}
  onPersonalChange(_cb: any) {}
  onInternalWrite(cb: (p: string, c: string) => void | Promise<void>) {
    this.internalCallbacks.push(cb);
  }
  async emitInternalWrite(p: string, c: string) {
    for (const cb of this.internalCallbacks) await cb(p, c);
  }
}

class StubSidecar { async getThreadsForDocument(_p: string) { return []; } }
class FakeEmbed {
  get ready() { return true; }
  async onModuleInit() {}
  whenReady() { return Promise.resolve(); }
  async embed(t: string) {
    const v = new Float32Array(768);
    for (let i = 0; i < t.length; i++) v[t.charCodeAt(i) % 768] += 1;
    return v;
  }
}

describe('SearchService — internal-write skips storage.read under load', () => {
  let ds: DataSource;
  let storage: CountingStorage;
  let watcher: StubFileWatcher;
  let service: SearchService;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    storage = new CountingStorage();
    watcher = new StubFileWatcher();
    service = new SearchService(
      ds as any,
      storage as any,
      watcher as any,
      new FakeEmbed() as any,
      new StubSidecar() as any,
      { trackSearch: () => {}, logFailedSearch: async () => {} } as any,
      stage1Predicates() as any,
    );
    storage.setFile('docs/foo.md', 'initial');
    await service.onModuleInit();
    // Drop any reads that occurred during the initial reindex.
    storage.readCalls = [];
  });

  afterEach(async () => { await ds.destroy(); });

  it('20 internal writes for one doc trigger zero storage.read calls', async () => {
    for (let i = 0; i < 20; i++) {
      await watcher.emitInternalWrite('docs/foo.md', `# rev ${i}\nbody ${i}`);
    }
    assert.equal(storage.readCalls.length, 0);

    // Final content should be reflected in FTS.
    const rows = await ds.query(`SELECT content FROM notes_fts WHERE path = 'docs/foo.md'`);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].content.includes('rev 19'));
  });
});
