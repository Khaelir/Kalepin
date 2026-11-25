import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { NoteLink } from '../entities';
import { LinkIndexService } from './link-index.service';

const ALICE = '_users/alice@example.com';
const BOB = '_users/bob@example.com';

let ds: DataSource;
let svc: LinkIndexService;
let files: Map<string, string>;
let internalWrite: (notePath: string, content: string) => Promise<void>;

beforeEach(async () => {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [NoteLink], synchronize: true });
  await ds.initialize();
  files = new Map();
  const storage = {
    async list() { return []; },
    async read(p: string) {
      const content = files.get(p);
      if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return content;
    },
    async write(p: string, content: string) { files.set(p, content); },
  };
  const fileWatcher = {
    onFileChange() {},
    onPersonalChange() {},
    onInternalWrite(cb: typeof internalWrite) { internalWrite = cb; },
  };
  svc = new LinkIndexService(ds.getRepository(NoteLink), storage as any, ds, fileWatcher as any);
  await svc.onModuleInit();
});

afterEach(async () => {
  clearInterval((svc as any).healSweepTimer);
  if (ds?.isInitialized) await ds.destroy();
});

/** A note saved through Kalepin: written, then announced on the internal-write channel. */
async function save(notePath: string, content: string): Promise<void> {
  files.set(notePath, content);
  await internalWrite(notePath, content);
}

async function targetsFrom(sourcePath: string): Promise<(string | null)[]> {
  const rows = await ds.getRepository(NoteLink).find({ where: { sourcePath }, order: { id: 'ASC' } });
  return rows.map((r) => r.targetPath);
}

describe('LinkIndexService — link namespaces', () => {
  it("never resolves a shared note's or another user's link to a personal note", async () => {
    await save(`${BOB}/plan.md`, 'See [[Roadmap]].');
    await save('Notes/index.md', `See [[Roadmap]], [[${ALICE}/Roadmap]] and [it](../${ALICE}/Roadmap.md).`);
    await save(`${ALICE}/todo.md`, 'See [[Roadmap]].');

    await save(`${ALICE}/Roadmap.md`, '# Roadmap');

    assert.deepEqual(await targetsFrom(`${BOB}/plan.md`), [null]);
    assert.deepEqual(await targetsFrom('Notes/index.md'), [null, null, null]);
    assert.deepEqual(await targetsFrom(`${ALICE}/todo.md`), [`${ALICE}/Roadmap.md`]);

    // A note written after the target exists resolves the same way.
    await save(`${BOB}/later.md`, 'See [[Roadmap]].');
    assert.deepEqual(await targetsFrom(`${BOB}/later.md`), [null]);
  });

  it("resolves a personal note's link to its owner's note before a shared one", async () => {
    await save('Notes/Roadmap.md', '# Shared roadmap');
    await save(`${ALICE}/todo.md`, 'See [[Roadmap]].');
    await save(`${BOB}/todo.md`, 'See [[Roadmap]].');
    assert.deepEqual(await targetsFrom(`${ALICE}/todo.md`), ['Notes/Roadmap.md']);

    await save(`${ALICE}/Roadmap.md`, '# My roadmap');

    assert.deepEqual(await targetsFrom(`${ALICE}/todo.md`), [`${ALICE}/Roadmap.md`]);
    assert.deepEqual(await targetsFrom(`${BOB}/todo.md`), ['Notes/Roadmap.md']);
  });

  it("renaming a personal note leaves notes that may not link to it untouched", async () => {
    await save(`${ALICE}/Roadmap.md`, '# Roadmap');
    await save(`${ALICE}/todo.md`, 'See [[Roadmap]].');
    await save('Notes/index.md', 'See [[Roadmap]].');
    // A row an index built before namespaces were enforced may still hold.
    await ds.getRepository(NoteLink).update({ sourcePath: 'Notes/index.md' }, { targetPath: `${ALICE}/Roadmap.md` });

    files.set(`${ALICE}/Roadmap-acquisition.md`, files.get(`${ALICE}/Roadmap.md`)!);
    files.delete(`${ALICE}/Roadmap.md`);
    await svc.rewriteLinksOnRename(`${ALICE}/Roadmap.md`, `${ALICE}/Roadmap-acquisition.md`);

    assert.equal(files.get(`${ALICE}/todo.md`), 'See [[Roadmap-acquisition]].');
    assert.equal(files.get('Notes/index.md'), 'See [[Roadmap]].');
    assert.deepEqual(await targetsFrom('Notes/index.md'), [null]);
  });

  it('moving a shared note into a personal folder rewrites only its owner\'s links', async () => {
    await save('Notes/Plan.md', '# Plan');
    await save('Notes/index.md', 'See [[Plan]].');
    await save(`${ALICE}/todo.md`, 'See [[Notes/Plan]].');

    files.set(`${ALICE}/Plan.md`, files.get('Notes/Plan.md')!);
    files.delete('Notes/Plan.md');
    await svc.rewriteLinksOnRename('Notes/Plan.md', `${ALICE}/Plan.md`);

    assert.equal(files.get('Notes/index.md'), 'See [[Plan]].');
    assert.deepEqual(await targetsFrom('Notes/index.md'), [null]);
    assert.equal(files.get(`${ALICE}/todo.md`), `See [[${ALICE}/Plan]].`);
    assert.deepEqual(await targetsFrom(`${ALICE}/todo.md`), [`${ALICE}/Plan.md`]);
  });

  it('leaves links unresolved when their note moves into an end-to-end encrypted folder', async () => {
    await save(`${ALICE}/Plan.md`, '# Plan');
    await save(`${ALICE}/todo.md`, 'See [[Plan]].');

    files.set(`${ALICE}/_secure/Plan.md`, files.get(`${ALICE}/Plan.md`)!);
    files.delete(`${ALICE}/Plan.md`);
    await svc.rewriteLinksOnRename(`${ALICE}/Plan.md`, `${ALICE}/_secure/Plan.md`);

    assert.equal(files.get(`${ALICE}/todo.md`), 'See [[Plan]].');
    assert.deepEqual(await targetsFrom(`${ALICE}/todo.md`), [null]);
    await save(`${ALICE}/later.md`, 'See [[Plan]].');
    assert.deepEqual(await targetsFrom(`${ALICE}/later.md`), [null]);
  });
});
