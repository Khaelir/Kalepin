import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { NoteTag } from '../entities/note-tag.entity';
import { TagIndexService } from '../tags/tag-index.service';
import { SearchService } from './search.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

const predicates = {
  isEncryptedAtRest: () => false,
  isE2EEncrypted: () => false,
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
};

class StubStorage {
  files = new Map<string, string>();
  mtimes = new Map<string, number>();
  put(p: string, content: string, mtime: number) {
    this.files.set(p, content);
    this.mtimes.set(p, mtime);
  }
  async read(p: string) {
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`Not found: ${p}`);
    return c;
  }
  async stat(p: string) {
    return { mtime: new Date(this.mtimes.get(p) ?? 0) };
  }
  async list(dir: string) {
    return [...this.files.keys()]
      .filter((p) => (dir ? p.startsWith(`${dir}/`) : !p.startsWith('_users/')))
      .map((p) => ({ name: p, path: p, type: 'file' }));
  }
}

class StubWatcher {
  onFileChange() {}
  onPersonalChange() {}
  onInternalWrite() {}
}

/** Bag-of-characters embeddings: every note scores above the cosine threshold for similar text. */
class FakeEmbeddingService {
  get ready() {
    return true;
  }
  whenReady() {
    return Promise.resolve();
  }
  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(768);
    for (let i = 0; i < text.length; i++) vec[text.charCodeAt(i) % 768] += 1;
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < 768; i++) vec[i] /= norm;
    return vec;
  }
}

let ds: DataSource;
let storage: StubStorage;
let tags: TagIndexService;
let search: SearchService;
let failedSearches: string[];

async function boot(withEmbeddings = true) {
  const watcher = new StubWatcher();
  tags = new TagIndexService(ds, storage as any, watcher as any);
  await tags.onModuleInit();
  failedSearches = [];
  const embeddings = withEmbeddings
    ? new FakeEmbeddingService()
    : { ready: false, whenReady: () => Promise.resolve(), embed: async () => new Float32Array(768) };
  search = new SearchService(
    ds as any,
    storage as any,
    watcher as any,
    embeddings as any,
    { getThreadsForDocument: async () => [] } as any,
    { trackSearch: () => {}, logFailedSearch: async (q: string) => { failedSearches.push(q); } } as any,
    predicates as any,
    { visibleGrantSet: async () => new Set<string>() } as any,
    undefined,
    tags,
  );
  await search.onModuleInit();
}

beforeEach(async () => {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [NoteTag], synchronize: true });
  await ds.initialize();
  storage = new StubStorage();
  storage.put('meeting-old.md', '---\ntags: [meeting]\n---\nBudget review for Q2.', 100);
  storage.put('meeting-new.md', '# Weekly\n\nBudget review again. #meeting/weekly', 300);
  storage.put('untagged.md', 'Budget review without any tag.', 400);
  storage.put('both.md', 'Roadmap #meeting #roadmap', 200);
});

afterEach(async () => {
  tags?.onModuleDestroy();
  await ds.destroy();
});

describe('SearchService — tag: filter', () => {
  it('lists tagged notes by recency for a tag-only query', async () => {
    await boot();
    const results = await search.search('tag:meeting', 'frontend', ALICE);
    assert.deepEqual(results.map((r) => r.path), ['meeting-new.md', 'both.md', 'meeting-old.md']);
    assert.equal(results[0].modifiedAt, new Date(300).toISOString());
    assert.equal(results[0].score, 1);
    assert.equal(results[2].snippet, 'Budget review for Q2.', 'frontmatter is stripped from the excerpt');
  });

  it('includes nested tags and ANDs several tag tokens', async () => {
    await boot();
    assert.deepEqual(
      (await search.search('tag:meeting/weekly', 'frontend')).map((r) => r.path),
      ['meeting-new.md'],
    );
    assert.deepEqual(
      (await search.search('tag:meeting tag:roadmap', 'frontend')).map((r) => r.path),
      ['both.md'],
    );
  });

  it('restricts a text search to tagged notes (FTS and vectors)', async () => {
    await boot(true);
    const paths = (await search.search('tag:meeting budget review', 'frontend')).map((r) => r.path);
    assert.ok(paths.includes('meeting-old.md'));
    assert.ok(paths.includes('meeting-new.md'));
    assert.ok(!paths.includes('untagged.md'), `untagged note leaked through: ${paths.join(', ')}`);

    const unfiltered = (await search.search('budget review', 'frontend')).map((r) => r.path);
    assert.ok(unfiltered.includes('untagged.md'), 'sanity: the text alone matches the untagged note');
  });

  it('returns nothing (and logs a failed search) for an unknown tag', async () => {
    await boot();
    assert.deepEqual(await search.search('tag:nope budget', 'mcp'), []);
    assert.deepEqual(await search.search('tag:nope', 'mcp'), []);
    assert.deepEqual(failedSearches, ['tag:nope budget', 'tag:nope']);
  });

  it('applies visibility to tag-only and tag + text queries', async () => {
    storage.put(`_users/${ALICE}/private.md`, 'Budget review #meeting', 500);
    await boot(false);
    await tags.indexFile(`_users/${ALICE}/private.md`, 'Budget review #meeting');
    await search.indexNote(`_users/${ALICE}/private.md`, 'Budget review #meeting');

    const alice = (await search.search('tag:meeting', 'frontend', ALICE)).map((r) => r.path);
    const bob = (await search.search('tag:meeting', 'frontend', BOB)).map((r) => r.path);
    assert.ok(alice.includes(`_users/${ALICE}/private.md`));
    assert.ok(!bob.includes(`_users/${ALICE}/private.md`));

    const bobText = (await search.search('tag:meeting budget', 'frontend', BOB)).map((r) => r.path);
    assert.ok(!bobText.includes(`_users/${ALICE}/private.md`));
  });

  it('keeps quoted tag: tokens as text', async () => {
    await boot(false);
    // No note contains the literal phrase; without the quote rule this would list meeting notes.
    assert.deepEqual(await search.search('"tag:meeting"', 'frontend'), []);
  });
});
