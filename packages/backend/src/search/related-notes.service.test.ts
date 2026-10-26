import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchService } from './search.service';
import { RelatedNotesService } from './related-notes.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { LinkIndexService } from '../links/link-index.service';
import { isE2EPath } from '../crypto/encryption-predicates';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';

// Synthetic embedder: each `zz*` vocabulary word is one dimension; everything
// else (filler, headings, the path prefix on chunk 0) is ignored. Note
// similarity is then fully controlled by word counts, e.g.
// (3 deploy, 1 kube) vs (4 deploy, 1 kube) → 0.997; vs (3 deploy, 1 budget) → 0.90.
const VOCAB = ['zzdeploy', 'zzkube', 'zzbudget', 'zzbread', 'zzgarden', 'zztravel'];
const FILLER = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';

class FakeEmbeddingService {
  ready = true;
  async onModuleInit() {}
  whenReady() { return Promise.resolve(); }
  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(768);
    for (const word of text.match(/zz[a-z]+/g) ?? []) {
      const dim = VOCAB.indexOf(word);
      if (dim >= 0) vec[dim] += 1;
    }
    if (vec.every((x) => x === 0)) vec[767] = 1;
    let norm = 0;
    for (const x of vec) norm += x * x;
    norm = Math.sqrt(norm);
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }
}

/** A one-section note body whose vector is the given word counts. */
function body(counts: Partial<Record<string, number>>): string {
  const words = Object.entries(counts).flatMap(([w, n]) => Array(n).fill(`zz${w}`));
  return `${FILLER}\n\n${words.join(' ')}\n`;
}

class StubStorage {
  files = new Map<string, string>();
  async read(p: string) {
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`Not found: ${p}`);
    return c;
  }
  async list() {
    return [...this.files.keys()].map((p) => ({ path: p, type: 'file' }));
  }
}

class StubFileWatcher {
  private callbacks: ((event: any) => void)[] = [];
  onFileChange(cb: (event: any) => void) { this.callbacks.push(cb); }
  onPersonalChange(cb: (event: any) => void) { this.callbacks.push(cb); }
  onInternalWrite() {}
  emit(event: any) { for (const cb of this.callbacks) cb(event); }
}

interface LinkRow { sourcePath: string; targetPath: string | null }

let ds: DataSource;
let storage: StubStorage;
let watcher: StubFileWatcher;
let embedder: FakeEmbeddingService;
let search: SearchService;
let related: RelatedNotesService;
let pinned: Set<string>;
let grantsByEmail: Map<string, string[]>;
let links: LinkRow[];

async function addNote(p: string, content: string): Promise<void> {
  storage.files.set(p, content);
  await search.embedNow(p, content);
}

async function paths(source: string, email?: string, limit?: number): Promise<string[]> {
  const res = await related.findRelated(source, { userEmail: email, limit });
  return res.items.map((i) => i.path);
}

beforeEach(async () => {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
  await ds.initialize();
  storage = new StubStorage();
  watcher = new StubFileWatcher();
  embedder = new FakeEmbeddingService();
  pinned = new Set();
  grantsByEmail = new Map();
  links = [];

  // Search indexes everything (stage-1 predicates), so the related service's
  // own E2E exclusion is exercised against embeddings that do exist.
  const indexEverything = {
    isEncryptedAtRest: () => false,
    isE2EEncrypted: () => false,
    shouldIndexPlaintext: () => true,
    canCollab: () => true,
    commentBodiesEncrypted: () => false,
    shareLinkMintable: () => true,
  };
  const e2eAware = {
    ...indexEverything,
    isE2EEncrypted: (p: string) => isE2EPath(p),
    shouldIndexPlaintext: (p: string) => !isE2EPath(p),
  };
  search = new SearchService(
    ds as any,
    storage as any,
    watcher as any,
    embedder as any,
    { getThreadsForDocument: async () => [] } as any,
    { trackSearch: () => {}, logFailedSearch: async () => {} } as any,
    indexEverything as any,
  );
  await search.onModuleInit();

  const grants = {
    async findActive(p: string, email: string) {
      return grantsByEmail.get(email)?.includes(p) ? { path: p, permission: 'read' } : null;
    },
    async listForGrantee(email: string) {
      return (grantsByEmail.get(email) ?? []).map((p) => ({ path: p, permission: 'read' }));
    },
  };
  const linkRepo = {
    async find({ where }: any) {
      if ('sourcePath' in where) return links.filter((l) => l.sourcePath === where.sourcePath);
      return links.filter((l) => l.targetPath === where.targetPath);
    },
  };
  const linkIndex = new LinkIndexService(linkRepo as any, {} as any, {} as any, {} as any);
  related = new RelatedNotesService(
    search,
    embedder as any,
    new GrantAwareVisibility(grants as any),
    { hasPin: async (p: string) => pinned.has(p) } as any,
    e2eAware as any,
    linkIndex,
  );
  related.onModuleInit();

  await addNote('Ops/Deploy.md', `# Deploy\n\n${body({ deploy: 3, kube: 1 })}`);
  await addNote('Ops/Rollback.md', body({ deploy: 4, kube: 1 }));
  await addNote('Ops/Cluster.md', body({ deploy: 3, budget: 1 }));
  await addNote('Recipes/Bread.md', body({ bread: 3 }));
});

afterEach(async () => {
  await ds.destroy();
});

describe('RelatedNotesService — ranking', () => {
  it('ranks by mean-vector similarity, drops notes below the floor, never returns the source', async () => {
    const res = await related.findRelated('Ops/Deploy.md', { userEmail: BOB });
    assert.equal(res.available, true);
    assert.deepEqual(res.items.map((i) => i.path), ['Ops/Rollback.md', 'Ops/Cluster.md']);
    assert.ok(res.items[0].score > res.items[1].score);
    assert.ok(Math.abs(res.items[1].score - 0.9) < 1e-4, `Cluster scores 0.90, got ${res.items[1].score}`);
    assert.equal(res.items[0].title, 'Rollback');
  });

  it('honours the limit', async () => {
    assert.deepEqual(await paths('Ops/Deploy.md', BOB, 1), ['Ops/Rollback.md']);
  });

  it('uses every chunk: the mean of a multi-section note', async () => {
    // Half deploy, half bread: mean ≈ (deploy + bread)/√2 → 0.67 vs Deploy, below the floor.
    await addNote('Mixed.md', `## A\n\n${body({ deploy: 1 })}\n## B\n\n${body({ bread: 1 })}`);
    assert.ok(!(await paths('Ops/Deploy.md', BOB, 20)).includes('Mixed.md'));
    assert.ok(!(await paths('Recipes/Bread.md', BOB, 20)).includes('Mixed.md'));
  });

  it('explains each result with the best-matching chunk pair', async () => {
    await addNote('Plan.md', `## Rollout\n\n${body({ deploy: 3 })}\n## Money\n\n${body({ budget: 3 })}`);
    await addNote('Runbook.md', `## Garden chores\n\n${body({ garden: 3 })}\n## Deployment\n\n${body({ deploy: 3 })}`);
    // Lower the floor for this pair: their means are only partly aligned.
    process.env.RELATED_NOTES_MIN_SCORE = '0.3';
    try {
      const res = await related.findRelated('Plan.md', { userEmail: BOB, limit: 20 });
      const item = res.items.find((i) => i.path === 'Runbook.md')!;
      assert.ok(item, 'Runbook.md is related');
      assert.equal(item.reason?.heading, 'Deployment');
      assert.equal(item.reason?.sourceHeading, 'Rollout');
      assert.ok(item.reason?.excerpt.includes('zzdeploy'));
      assert.ok(!item.reason?.excerpt.includes('## Deployment'), 'heading line is not part of the excerpt');
    } finally {
      delete process.env.RELATED_NOTES_MIN_SCORE;
    }
  });

  it('flags notes linked in either direction', async () => {
    await addNote('Ops/Kube.md', body({ deploy: 3, kube: 2 }));
    links = [
      { sourcePath: 'Ops/Deploy.md', targetPath: 'Ops/Rollback.md' }, // outgoing
      { sourcePath: 'Ops/Cluster.md', targetPath: 'Ops/Deploy.md' },  // backlink
      { sourcePath: 'Ops/Deploy.md', targetPath: null },               // broken link
    ];
    const res = await related.findRelated('Ops/Deploy.md', { userEmail: BOB });
    const linked = Object.fromEntries(res.items.map((i) => [i.path, i.linked]));
    assert.deepEqual(linked, { 'Ops/Rollback.md': true, 'Ops/Kube.md': false, 'Ops/Cluster.md': true });
  });

  it('answers available: false when the model is not loaded', async () => {
    embedder.ready = false;
    assert.deepEqual(await related.findRelated('Ops/Deploy.md', { userEmail: BOB }), { available: false, items: [] });
  });

  it('answers an empty list for a note that has no embeddings yet', async () => {
    storage.files.set('Fresh.md', '');
    assert.deepEqual(await related.findRelated('Fresh.md', { userEmail: BOB }), { available: true, items: [] });
  });
});

describe('RelatedNotesService — visibility and exclusions', () => {
  beforeEach(async () => {
    // Identical to Ops/Deploy.md: would be the top match for anyone who can see it.
    await addNote(`_users/${ALICE}/Diary.md`, body({ deploy: 3, kube: 1 }));
    await addNote(`_users/${BOB}/Mine.md`, body({ deploy: 3, kube: 1 }));
    await addNote(`_users/${CAROL}/Shared with Bob.md`, body({ deploy: 3, kube: 1 }));
  });

  it("never returns another user's personal notes", async () => {
    const bob = await paths('Ops/Deploy.md', BOB, 20);
    assert.ok(!bob.includes(`_users/${ALICE}/Diary.md`));
    assert.ok(!bob.some((p) => p.startsWith(`_users/${CAROL}/`)), 'no grant yet');
    assert.ok(bob.includes(`_users/${BOB}/Mine.md`), 'own personal notes are candidates');
  });

  it('includes personal notes shared with the caller by grant', async () => {
    grantsByEmail.set(BOB, [`_users/${CAROL}/Shared with Bob.md`]);
    assert.ok((await paths('Ops/Deploy.md', BOB, 20)).includes(`_users/${CAROL}/Shared with Bob.md`));
  });

  it('owner sees their own personal note as related', async () => {
    const alice = await paths('Ops/Deploy.md', ALICE, 20);
    assert.ok(alice.includes(`_users/${ALICE}/Diary.md`));
    assert.ok(!alice.includes(`_users/${BOB}/Mine.md`));
  });

  it('404s on a source note the caller cannot read', async () => {
    await assert.rejects(
      related.findRelated(`_users/${ALICE}/Diary.md`, { userEmail: BOB }),
      NotFoundException,
    );
    await assert.rejects(related.findRelated('Ops/../_users/x/Diary.md', { userEmail: BOB }), NotFoundException);
  });

  it('never returns _secure, attachment or dot-folder notes', async () => {
    await addNote(`_users/${BOB}/_secure/Secret.md`, body({ deploy: 3, kube: 1 }));
    await addNote('_attachments/readme.md', body({ deploy: 3, kube: 1 }));
    await addNote('.trash/Ops/Old deploy.md', body({ deploy: 3, kube: 1 }));
    const bob = await paths('Ops/Deploy.md', BOB, 20);
    assert.ok(!bob.some((p) => p.includes('_secure') || p.includes('_attachments') || p.startsWith('.trash/')), bob.join(', '));
  });

  it('answers available: false for an end-to-end encrypted source note', async () => {
    await addNote(`_users/${ALICE}/_secure/Journal.md`, body({ deploy: 3, kube: 1 }));
    assert.deepEqual(
      await related.findRelated(`_users/${ALICE}/_secure/Journal.md`, { userEmail: ALICE }),
      { available: false, items: [] },
    );
  });

  it('lists a PIN-locked related note without its excerpt', async () => {
    pinned.add('Ops/Rollback.md');
    const res = await related.findRelated('Ops/Deploy.md', { userEmail: BOB });
    const locked = res.items.find((i) => i.path === 'Ops/Rollback.md')!;
    assert.equal(locked.reason, null);
    assert.ok(res.items.find((i) => i.path === 'Ops/Cluster.md')!.reason);
  });
});

describe('RelatedNotesService — mean-vector cache', () => {
  it('caches means and re-ranks a note whose embeddings were rewritten', async () => {
    assert.deepEqual(await paths('Ops/Deploy.md', BOB), ['Ops/Rollback.md', 'Ops/Cluster.md']);
    const cached = related.cachedMeanCount();
    assert.ok(cached >= 4, `means cached after the first pass (got ${cached})`);

    await addNote('Recipes/Bread.md', body({ deploy: 5, kube: 1 })); // now about deploys
    assert.equal(related.cachedMeanCount(), cached - 1, 'only the rewritten note is invalidated');
    assert.deepEqual(await paths('Ops/Deploy.md', BOB), ['Ops/Rollback.md', 'Recipes/Bread.md', 'Ops/Cluster.md']);
  });

  it('re-ranks when the source note itself changes', async () => {
    await paths('Ops/Deploy.md', BOB);
    await addNote('Ops/Deploy.md', body({ bread: 3, deploy: 1 }));
    assert.deepEqual(await paths('Ops/Deploy.md', BOB), ['Recipes/Bread.md']);
  });

  it('evicts a note moved to the trash (watcher unlink)', async () => {
    assert.ok((await paths('Ops/Deploy.md', BOB)).includes('Ops/Rollback.md'));
    storage.files.delete('Ops/Rollback.md');
    watcher.emit({ path: 'Ops/Rollback.md', event: 'unlink' });
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(await paths('Ops/Deploy.md', BOB), ['Ops/Cluster.md']);
  });

  it('reindexAll clears every cached mean and drops ghosts of deleted notes', async () => {
    await paths('Ops/Deploy.md', BOB);
    assert.ok(related.cachedMeanCount() > 0);
    // Deleted from disk while nothing was watching: embeddings and cache remain.
    storage.files.delete('Ops/Rollback.md');
    assert.ok((await paths('Ops/Deploy.md', BOB)).includes('Ops/Rollback.md'));

    await search.reindexAll();
    assert.deepEqual(await paths('Ops/Deploy.md', BOB), ['Ops/Cluster.md']);
  });
});
