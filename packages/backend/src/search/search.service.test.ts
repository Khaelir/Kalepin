import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { SearchService } from './search.service';
import { EmbeddingService } from './embedding.service';

/** Stage-1 predicate stub: stage 1 returns true everywhere for `shouldIndexPlaintext`. */
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

// Minimal stubs for testing without NestJS DI
function createSqliteDataSource(): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  });
}

class StubStorage {
  files = new Map<string, string>();

  async read(filePath: string): Promise<string> {
    const content = this.files.get(filePath);
    if (content === undefined) throw new Error(`Not found: ${filePath}`);
    return content;
  }

  async list(_dir: string): Promise<any[]> {
    return Array.from(this.files.keys()).map((p) => ({
      path: p,
      type: 'file',
    }));
  }

  watch() {
    return { close: () => {} };
  }
}

class StubFileWatcher {
  private callbacks: Array<(event: any) => void> = [];
  private internalWriteCallbacks: Array<(path: string, content: string) => void | Promise<void>> = [];
  onFileChange(cb: (event: any) => void) {
    this.callbacks.push(cb);
  }
  onPersonalChange(cb: (event: any) => void) {
    // Same callback list as shared — the stub fires both via `emit`. Per
    // SearchService.onModuleInit, both event sources feed the same indexer.
    this.callbacks.push(cb);
  }
  onInternalWrite(cb: (path: string, content: string) => void | Promise<void>) {
    this.internalWriteCallbacks.push(cb);
  }
  emit(event: any) {
    for (const cb of this.callbacks) cb(event);
  }
  async emitInternalWrite(path: string, content: string) {
    for (const cb of this.internalWriteCallbacks) {
      await cb(path, content);
    }
  }
}

class StubSidecarService {
  sidecars = new Map<string, any>();

  sidecarPath(filePath: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    return path.join(dir, `.${base}.collab`);
  }

  async read(filePath: string): Promise<any> {
    return this.sidecars.get(filePath) ?? { comments: {} };
  }

  async write(filePath: string, data: any): Promise<void> {
    this.sidecars.set(filePath, data);
  }

  async getThreadsForDocument(filePath: string): Promise<any[]> {
    const data = await this.read(filePath);
    const threads: any[] = [];
    for (const [blockId, block] of Object.entries(data.comments) as any) {
      for (const thread of block.threads) {
        threads.push({ ...thread, blockId });
      }
    }
    return threads;
  }
}

// Fake embedding service for deterministic testing
class FakeEmbeddingService {
  get ready() {
    return true;
  }
  async onModuleInit() {}
  whenReady() {
    return Promise.resolve();
  }

  // Produce a deterministic bag-of-characters embedding for test determinism.
  // Characters map to fixed vector dimensions, so texts with overlapping words
  // produce similar embeddings (more realistic than positional encoding).
  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(768);
    for (let i = 0; i < text.length; i++) {
      const dim = text.charCodeAt(i) % 768;
      vec[dim] += 1;
    }
    // Normalize
    let norm = 0;
    for (let i = 0; i < 768; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < 768; i++) vec[i] /= norm;
    return vec;
  }
}

describe('SearchService', () => {
  let ds: DataSource;
  let storage: StubStorage;
  let watcher: StubFileWatcher;
  let embeddingService: FakeEmbeddingService;
  let sidecarService: StubSidecarService;
  let service: SearchService;

  beforeEach(async () => {
    ds = createSqliteDataSource();
    await ds.initialize();
    storage = new StubStorage();
    watcher = new StubFileWatcher();
    embeddingService = new FakeEmbeddingService();
    sidecarService = new StubSidecarService();

    const dailyStatsMock = {
      trackSearch: () => {},
      logFailedSearch: async () => {},
    };
    service = new SearchService(
      ds as any,
      storage as any,
      watcher as any,
      embeddingService as any,
      sidecarService as any,
      dailyStatsMock as any,
      stage1Predicates() as any,
    );
  });

  afterEach(async () => {
    await ds.destroy();
  });

  describe('hybrid search', () => {
    it('returns FTS-only results when query matches keywords', async () => {
      storage.files.set('note1.md', '# Hello World\nThis is about JavaScript programming.');
      storage.files.set('note2.md', '# Cooking\nHow to make pasta.');
      await service.onModuleInit();

      const results = await service.search('JavaScript');
      assert.ok(results.length > 0);
      assert.equal(results[0].path, 'note1.md');
    });

    it('returns vector results for semantic queries', async () => {
      storage.files.set('note1.md', '# Task Management\nManage your todos and kanban boards efficiently.');
      storage.files.set('note2.md', '# Unrelated\nSomething completely different about geology and rocks.');
      await service.onModuleInit();

      // Vector search should find similar content — use overlapping text for fake embeddings
      const vectorResults = await service.vectorSearch('Manage your todos and kanban boards', 10);
      assert.ok(vectorResults.length > 0);
    });

    it('deduplicates results by path in merged output', async () => {
      storage.files.set('note1.md', '# Test\nSome test content about searching.');
      await service.onModuleInit();

      const results = await service.search('test');
      const paths = results.map((r) => r.path);
      const unique = new Set(paths);
      assert.equal(paths.length, unique.size, 'Results should have unique paths');
    });

    it('gracefully degrades when embeddings not ready', async () => {
      // Use an embedding service that reports not ready
      const notReadyService = { ready: false, onModuleInit: async () => {}, whenReady: () => Promise.resolve(), embed: async () => new Float32Array(768) };
      const dailyStatsMock2 = { trackSearch: () => {}, logFailedSearch: async () => {} };
      const svc = new SearchService(ds as any, storage as any, watcher as any, notReadyService as any, sidecarService as any, dailyStatsMock2 as any, stage1Predicates() as any);
      storage.files.set('note1.md', '# Hello\nWorld');
      await svc.onModuleInit();

      const results = await svc.search('Hello');
      assert.ok(results.length > 0, 'Should return FTS-only results');
    });
  });

  describe('watcher integration', () => {
    it('indexes embeddings on file add', async () => {
      await service.onModuleInit();

      storage.files.set('new.md', '# New Note\nFresh content.');
      watcher.emit({ path: 'new.md', event: 'add' });

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 100));

      const results = await service.search('Fresh');
      assert.ok(results.length > 0);
      assert.equal(results[0].path, 'new.md');
    });

    it('re-indexes embeddings on file change', async () => {
      storage.files.set('note.md', '# Original\nOriginal content.');
      await service.onModuleInit();

      storage.files.set('note.md', '# Updated\nUpdated content about cats.');
      watcher.emit({ path: 'note.md', event: 'change' });
      await new Promise((r) => setTimeout(r, 100));

      const results = await service.search('Updated');
      assert.ok(results.length > 0);
    });

    it('removes embeddings on file delete', async () => {
      storage.files.set('note.md', '# Delete Me\nContent to be deleted.');
      await service.onModuleInit();

      storage.files.delete('note.md');
      watcher.emit({ path: 'note.md', event: 'unlink' });
      await new Promise((r) => setTimeout(r, 100));

      const embRows: any[] = await ds.query(
        `SELECT COUNT(*) as count FROM note_embeddings WHERE path = ?`,
        ['note.md'],
      );
      assert.equal(embRows[0].count, 0);
    });

    it('ignores non-markdown files', async () => {
      await service.onModuleInit();

      watcher.emit({ path: 'image.png', event: 'add' });
      await new Promise((r) => setTimeout(r, 50));
      // Should not throw or affect index
    });
  });

  describe('comment search', () => {
    it('indexes and finds comment text via FTS', async () => {
      storage.files.set('note1.md', '# Meeting Notes\nDiscussed the roadmap.');
      sidecarService.sidecars.set('note1.md', {
        comments: {
          'block-1': {
            threads: [
              {
                id: 'thread-1',
                blockId: 'block-1',
                quotedText: 'roadmap',
                comments: [
                  { id: 'c1', author: 'alice@test.com', text: 'We should prioritize the authentication feature', createdAt: '2026-01-01T00:00:00Z' },
                ],
                resolved: false,
              },
            ],
          },
        },
      });
      await service.onModuleInit();

      const results = await service.search('authentication');
      assert.ok(results.length > 0, 'Should find comment text');
      const commentResult = results.find((r) => r.type === 'comment');
      assert.ok(commentResult, 'Should have a comment-type result');
      assert.equal(commentResult.path, 'note1.md');
      assert.equal(commentResult.threadId, 'thread-1');
      assert.equal(commentResult.commentAuthor, 'alice@test.com');
    });

    it('returns both note and comment results for matching terms', async () => {
      storage.files.set('note1.md', '# Security\nSecurity best practices.');
      sidecarService.sidecars.set('note1.md', {
        comments: {
          'block-1': {
            threads: [
              {
                id: 'thread-1',
                blockId: 'block-1',
                comments: [
                  { id: 'c1', author: 'bob@test.com', text: 'Security audit needed', createdAt: '2026-01-01T00:00:00Z' },
                ],
                resolved: false,
              },
            ],
          },
        },
      });
      await service.onModuleInit();

      const results = await service.search('Security');
      const noteResults = results.filter((r) => r.type !== 'comment');
      const commentResults = results.filter((r) => r.type === 'comment');
      assert.ok(noteResults.length > 0, 'Should have note results');
      assert.ok(commentResults.length > 0, 'Should have comment results');
    });

    it('reindexAll includes comments', async () => {
      storage.files.set('doc.md', '# Doc\nSome content.');
      sidecarService.sidecars.set('doc.md', {
        comments: {
          'block-1': {
            threads: [
              {
                id: 'thread-abc',
                blockId: 'block-1',
                comments: [
                  { id: 'c1', author: 'user@test.com', text: 'unique-comment-keyword', createdAt: '2026-01-01T00:00:00Z' },
                ],
                resolved: false,
              },
            ],
          },
        },
      });
      await service.onModuleInit();

      // Verify comments_fts has entries
      const ftsRows: any[] = await ds.query(`SELECT COUNT(*) as count FROM comments_fts`);
      assert.ok(ftsRows[0].count > 0, 'comments_fts should have entries after reindexAll');

      // Verify comment embeddings exist
      const embRows: any[] = await ds.query(
        `SELECT COUNT(*) as count FROM note_embeddings WHERE source = 'comment'`,
      );
      assert.ok(embRows[0].count > 0, 'Should have comment embeddings after reindexAll');
    });

    it('removeNoteComments clears FTS and embedding entries', async () => {
      storage.files.set('note.md', '# Note\nContent.');
      sidecarService.sidecars.set('note.md', {
        comments: {
          'block-1': {
            threads: [
              {
                id: 'thread-1',
                blockId: 'block-1',
                comments: [
                  { id: 'c1', author: 'user@test.com', text: 'a comment', createdAt: '2026-01-01T00:00:00Z' },
                ],
                resolved: false,
              },
            ],
          },
        },
      });
      await service.onModuleInit();

      await service.removeNoteComments('note.md');

      const ftsRows: any[] = await ds.query(
        `SELECT COUNT(*) as count FROM comments_fts WHERE path = ?`,
        ['note.md'],
      );
      assert.equal(ftsRows[0].count, 0, 'comments_fts should be empty after removal');

      const embRows: any[] = await ds.query(
        `SELECT COUNT(*) as count FROM note_embeddings WHERE path = ? AND source = 'comment'`,
        ['note.md'],
      );
      assert.equal(embRows[0].count, 0, 'comment embeddings should be empty after removal');
    });
  });

  describe('FTS ranking improvements', () => {
    it('ranks title matches higher than body matches (column weights)', async () => {
      // Use embedding service that's not ready — FTS-only ranking
      const ftsOnlyService = { ready: false, onModuleInit: async () => {}, whenReady: () => Promise.resolve(), embed: async () => new Float32Array(768) };
      const dailyStatsMock3 = { trackSearch: () => {}, logFailedSearch: async () => {} };
      const svc = new SearchService(ds as any, storage as any, watcher as any, ftsOnlyService as any, sidecarService as any, dailyStatsMock3 as any, stage1Predicates() as any);

      storage.files.set('infra.md', '# Kubernetes Guide\nHow to deploy apps.');
      storage.files.set('misc.md', '# Random Notes\nKubernetes is mentioned once here.');
      await svc.onModuleInit();

      const results = await svc.search('kubernetes');
      assert.ok(results.length >= 2);
      assert.equal(results[0].path, 'infra.md', 'Title match should rank higher');
    });

    it('ranks path matches higher than body matches', async () => {
      const ftsOnlyService = { ready: false, onModuleInit: async () => {}, whenReady: () => Promise.resolve(), embed: async () => new Float32Array(768) };
      const dailyStatsMock3 = { trackSearch: () => {}, logFailedSearch: async () => {} };
      const svc = new SearchService(ds as any, storage as any, watcher as any, ftsOnlyService as any, sidecarService as any, dailyStatsMock3 as any, stage1Predicates() as any);

      storage.files.set('recipes/pasta.md', '# Pasta\nHow to cook spaghetti.');
      storage.files.set('journal.md', '# Daily Log\nToday I tried new recipes for dinner.');
      await svc.onModuleInit();

      const results = await svc.search('recipes');
      assert.ok(results.length >= 2);
      assert.equal(results[0].path, 'recipes/pasta.md', 'Path match should rank higher');
    });

    it('uses AND-default and falls back to OR with few results', async () => {
      // Only one note has both "react" and "hooks"
      storage.files.set('react.md', '# React Hooks\nUseState and useEffect hooks in React.');
      storage.files.set('vue.md', '# Vue Guide\nReact to changes with watchers.');
      storage.files.set('hooks.md', '# Git Hooks\nPre-commit hooks for linting.');
      await service.onModuleInit();

      const results = await service.search('react hooks');
      assert.ok(results.length > 0);
      // AND query should find react.md (has both terms)
      assert.equal(results[0].path, 'react.md');
    });

    it('falls back to OR when AND returns fewer than 3 results', async () => {
      storage.files.set('only-one.md', '# Alpha Beta\nBoth terms here.');
      storage.files.set('alpha.md', '# Alpha Only\nJust the first term alpha.');
      storage.files.set('beta.md', '# Beta Only\nJust the second term beta.');
      await service.onModuleInit();

      const results = await service.search('alpha beta');
      // AND returns only 1 result (only-one.md), so falls back to OR with 3
      assert.ok(results.length >= 3, `Expected >= 3 results from OR fallback, got ${results.length}`);
    });

    it('supports quoted phrase matching', async () => {
      storage.files.set('exact.md', '# Guide\nLearn about error handling in JavaScript.');
      storage.files.set('separate.md', '# Other\nThere was an error. The handling was poor.');
      await service.onModuleInit();

      const results = await service.search('"error handling"');
      assert.ok(results.length > 0);
      // Exact phrase match should find exact.md
      assert.equal(results[0].path, 'exact.md');
    });
  });

  describe('vector search quality', () => {
    it('skips vector search for 1- and 2-char queries', async () => {
      storage.files.set('note.md', '# A Note\nSome content about many topics.');
      await service.onModuleInit();

      // 1-char query — FTS only
      const r1 = await service.search('a');
      assert.ok(r1.length >= 0); // should not error

      // 2-char query — FTS only
      const r2 = await service.search('ab');
      assert.ok(r2.length >= 0); // should not error

      // 3-char query should use vector search (no error)
      const r3 = await service.search('abc');
      assert.ok(r3.length >= 0);
    });
  });

  describe('query embedding cache', () => {
    it('caches query embeddings and reuses them', async () => {
      storage.files.set('note.md', '# Test\nContent for cache testing.');
      await service.onModuleInit();

      // Spy on embed calls
      let embedCallCount = 0;
      const originalEmbed = embeddingService.embed.bind(embeddingService);
      embeddingService.embed = async (text: string) => {
        embedCallCount++;
        return originalEmbed(text);
      };

      await service.vectorSearch('cache test query', 10);
      const firstCallCount = embedCallCount;

      await service.vectorSearch('cache test query', 10);
      // Second call should not invoke embed again (cache hit)
      assert.equal(embedCallCount, firstCallCount, 'Second search should reuse cached embedding');
    });

    it('evicts oldest entry when cache exceeds capacity', async () => {
      storage.files.set('note.md', '# Test\nContent.');
      await service.onModuleInit();

      // Fill cache beyond capacity (50)
      for (let i = 0; i < 52; i++) {
        await service.vectorSearch(`unique query number ${i}`, 10);
      }

      // The first query should have been evicted
      let embedCallCount = 0;
      const originalEmbed = embeddingService.embed.bind(embeddingService);
      embeddingService.embed = async (text: string) => {
        embedCallCount++;
        return originalEmbed(text);
      };

      await service.vectorSearch('unique query number 0', 10);
      assert.equal(embedCallCount, 1, 'Evicted query should require re-embedding');
    });
  });

  describe('in-memory vector cache', () => {
    it('lazy-loads embeddings on first vector search', async () => {
      storage.files.set('note.md', '# Lazy\nContent for lazy loading test.');
      await service.onModuleInit();

      // First search triggers cache load from SQLite
      const results1 = await service.vectorSearch('lazy loading test content', 10);
      assert.ok(results1.length >= 0);

      // Second search should use cache (no SQLite query)
      const results2 = await service.vectorSearch('lazy loading test content', 10);
      assert.ok(results2.length >= 0);
    });

    it('invalidates cache entry when note is re-indexed', async () => {
      storage.files.set('note.md', '# Original\nOriginal content for cache test.');
      await service.onModuleInit();

      // Trigger cache load
      await service.vectorSearch('original content', 10);

      // Re-index the note with new content
      await service.indexNoteEmbeddings('note.md', '# Updated\nCompletely new content about different topics.');

      // Vector search should reflect new content
      const results = await service.vectorSearch('completely new different topics', 10);
      if (results.length > 0) {
        assert.equal(results[0].path, 'note.md');
      }
    });

    it('removes cache entry when note embeddings are deleted', async () => {
      storage.files.set('note.md', '# Delete Me\nContent to be removed from cache.');
      await service.onModuleInit();

      // Trigger cache load
      await service.vectorSearch('delete me removed', 10);

      // Remove embeddings
      await service.removeNoteEmbeddings('note.md');

      // Verify note.md no longer appears in vector results
      const results = await service.vectorSearch('delete me removed', 10);
      const found = results.find((r) => r.path === 'note.md');
      assert.equal(found, undefined, 'Deleted note should not appear in vector results');
    });
  });

  describe('recency boost', () => {
    it('boosts recently modified notes in ranking ties', async () => {
      storage.files.set('recent.md', '# Search Topic\nDetailed analysis of search algorithms.');
      storage.files.set('old.md', '# Search Topic\nDetailed analysis of search algorithms.');

      // Add stat method to stub storage
      const now = new Date();
      const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      (storage as any).stat = async (filePath: string) => {
        if (filePath === 'recent.md') return { mtime: now };
        if (filePath === 'old.md') return { mtime: sixMonthsAgo };
        throw new Error('Not found');
      };

      await service.onModuleInit();
      const results = await service.search('search algorithms');

      // Both notes have identical content, so RRF scores should be equal
      // Recency boost should push recent.md ahead
      const recentIdx = results.findIndex((r) => r.path === 'recent.md');
      const oldIdx = results.findIndex((r) => r.path === 'old.md');
      assert.ok(recentIdx >= 0, 'recent.md should appear in results');
      assert.ok(oldIdx >= 0, 'old.md should appear in results');
      assert.ok(recentIdx < oldIdx, 'Recently modified note should rank higher');
    });
  });
});
