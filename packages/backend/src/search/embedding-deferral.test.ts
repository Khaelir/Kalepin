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

function createSqliteDataSource(): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  });
}

class StubStorage {
  files = new Map<string, string>();
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`Not found: ${p}`);
    return v;
  }
  async list(_dir: string): Promise<any[]> {
    return Array.from(this.files.keys()).map((p) => ({ path: p, type: 'file' }));
  }
  watch() { return { close: () => {} }; }
}

class StubFileWatcher {
  callbacks: Array<(event: any) => void> = [];
  internalWriteCallbacks: Array<(path: string, content: string) => void | Promise<void>> = [];
  onFileChange(cb: (event: any) => void) { this.callbacks.push(cb); }
  onPersonalChange(_cb: (event: any) => void) {}
  onInternalWrite(cb: (path: string, content: string) => void | Promise<void>) {
    this.internalWriteCallbacks.push(cb);
  }
}

class StubSidecarService {
  async getThreadsForDocument(_p: string): Promise<any[]> { return []; }
}

class FakeEmbeddingService {
  get ready() { return true; }
  async onModuleInit() {}
  whenReady() { return Promise.resolve(); }
  embedCalls: Array<{ text: string }> = [];
  async embed(text: string): Promise<Float32Array> {
    this.embedCalls.push({ text });
    const vec = new Float32Array(768);
    for (let i = 0; i < text.length; i++) {
      vec[text.charCodeAt(i) % 768] += 1;
    }
    return vec;
  }
}

class StubOTService {
  sessionManager = {
    sessions: new Map<string, { clients: Map<unknown, unknown> }>(),
    getSession(path: string) {
      return this.sessions.get(path);
    },
  };
  closeListeners: Array<(docId: string) => Promise<void> | void> = [];
  addSessionCloseListener(handler: (docId: string) => Promise<void> | void) {
    this.closeListeners.push(handler);
  }
  setActiveSession(path: string, clientCount: number) {
    if (clientCount === 0) {
      this.sessionManager.sessions.delete(path);
      return;
    }
    const clients = new Map<unknown, unknown>();
    for (let i = 0; i < clientCount; i++) clients.set({}, {});
    this.sessionManager.sessions.set(path, { clients });
  }
  async fireSessionClose(path: string) {
    for (const h of this.closeListeners) await h(path);
  }
}

describe('SearchService — embedding deferral (Phase 3a)', () => {
  let ds: DataSource;
  let storage: StubStorage;
  let watcher: StubFileWatcher;
  let embedding: FakeEmbeddingService;
  let sidecar: StubSidecarService;
  let ot: StubOTService;
  let service: SearchService;

  beforeEach(async () => {
    ds = createSqliteDataSource();
    await ds.initialize();
    storage = new StubStorage();
    watcher = new StubFileWatcher();
    embedding = new FakeEmbeddingService();
    sidecar = new StubSidecarService();
    ot = new StubOTService();

    const dailyStatsMock = {
      trackSearch: () => {},
      logFailedSearch: async () => {},
    };
    service = new SearchService(
      ds as any,
      storage as any,
      watcher as any,
      embedding as any,
      sidecar as any,
      dailyStatsMock as any,
      stage1Predicates() as any,
      undefined,
      ot as any,
    );
    await service.onModuleInit();
    embedding.embedCalls = []; // reset after initial reindex
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('embeds immediately when no OT session is active', async () => {
    service.scheduleEmbedding('mcp/created.md', '# Hello');
    // Synchronous-ish path; allow the inner promise to resolve.
    await new Promise((r) => setImmediate(r));
    assert.ok(embedding.embedCalls.length > 0, 'expected immediate embedding');
    assert.equal(service.pendingDeferredCount(), 0);
  });

  it('defers embedding while an OT session has connected clients', async () => {
    ot.setActiveSession('docs/foo.md', 1);
    service.scheduleEmbedding('docs/foo.md', '# Editing');
    await new Promise((r) => setImmediate(r));
    assert.equal(embedding.embedCalls.length, 0, 'embedding must not run synchronously');
    assert.equal(service.pendingDeferredCount(), 1);
    assert.equal(service.peekDeferredContent('docs/foo.md'), '# Editing');
  });

  it('repeated flushes during the inactivity window replace held content', async () => {
    ot.setActiveSession('docs/foo.md', 1);
    service.scheduleEmbedding('docs/foo.md', 'v1');
    service.scheduleEmbedding('docs/foo.md', 'v2');
    service.scheduleEmbedding('docs/foo.md', 'v3-final');
    await new Promise((r) => setImmediate(r));
    assert.equal(embedding.embedCalls.length, 0);
    assert.equal(service.peekDeferredContent('docs/foo.md'), 'v3-final');
  });

  it('flushPendingEmbedding drains the held content immediately', async () => {
    ot.setActiveSession('docs/foo.md', 1);
    service.scheduleEmbedding('docs/foo.md', 'final-content');
    await service.flushPendingEmbedding('docs/foo.md');
    assert.ok(embedding.embedCalls.length > 0);
    assert.equal(service.pendingDeferredCount(), 0);
  });

  it('session close triggers a flush of any pending deferred embedding', async () => {
    ot.setActiveSession('docs/bar.md', 1);
    service.scheduleEmbedding('docs/bar.md', 'pre-close');
    assert.equal(service.pendingDeferredCount(), 1);
    ot.setActiveSession('docs/bar.md', 0);
    await ot.fireSessionClose('docs/bar.md');
    assert.equal(service.pendingDeferredCount(), 0);
    assert.ok(embedding.embedCalls.length > 0);
  });

  it('session close with no pending embedding is a no-op', async () => {
    await ot.fireSessionClose('docs/none.md');
    assert.equal(embedding.embedCalls.length, 0);
  });

  it('cancelDeferredEmbedding via removeNoteEmbeddings on unlink event', async () => {
    ot.setActiveSession('docs/del.md', 1);
    service.scheduleEmbedding('docs/del.md', 'soon-to-die');
    assert.equal(service.pendingDeferredCount(), 1);
    // Simulate unlink via the watcher pipeline.
    storage.files.delete('docs/del.md');
    for (const cb of watcher.callbacks) await cb({ event: 'unlink', path: 'docs/del.md' });
    assert.equal(service.pendingDeferredCount(), 0);
  });

  it('switching from active to no-active session embeds the next flush immediately', async () => {
    ot.setActiveSession('docs/foo.md', 1);
    service.scheduleEmbedding('docs/foo.md', 'while-active');
    assert.equal(service.pendingDeferredCount(), 1);
    ot.setActiveSession('docs/foo.md', 0);
    service.scheduleEmbedding('docs/foo.md', 'after-disconnect');
    await new Promise((r) => setImmediate(r));
    assert.ok(embedding.embedCalls.length > 0);
    assert.equal(service.pendingDeferredCount(), 0);
  });
});
