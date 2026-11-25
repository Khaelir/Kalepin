import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { NoteLink } from '../entities';
import { OTService } from '../ot/ot.service';
import { LinkIndexService } from './link-index.service';

let ds: DataSource;
let svc: LinkIndexService;
let ot: OTService;
let files: Map<string, string>;
let broadcasts: string[];
let internalWrite: (notePath: string, content: string) => Promise<void>;

beforeEach(async () => {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [NoteLink], synchronize: true });
  await ds.initialize();
  files = new Map();
  broadcasts = [];
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
  ot = new OTService(storage as any, { async save() {} } as any, { async trackChange() {} } as any);
  svc = new LinkIndexService(ds.getRepository(NoteLink), storage as any, ds, fileWatcher as any, ot);
  svc.setOTBroadcast((docId) => broadcasts.push(docId));
  await svc.onModuleInit();
});

afterEach(async () => {
  clearInterval((svc as any).healSweepTimer);
  for (const session of (ot.sessionManager as any).sessions.values()) {
    clearTimeout(session.flushTimer);
    clearTimeout(session.inactivityTimer);
  }
  if (ds?.isInitialized) await ds.destroy();
});

/** A note saved through Kalepin: written, then announced on the internal-write channel. */
async function save(notePath: string, content: string): Promise<void> {
  files.set(notePath, content);
  await internalWrite(notePath, content);
}

/** What FilesService.move does: the file moves, then links follow. */
async function rename(from: string, to: string): Promise<void> {
  files.set(to, files.get(from)!);
  files.delete(from);
  await svc.rewriteLinksOnRename(from, to);
}

async function targetsFrom(sourcePath: string): Promise<(string | null)[]> {
  const rows = await ds.getRepository(NoteLink).find({ where: { sourcePath }, order: { id: 'ASC' } });
  return rows.map((r) => r.targetPath);
}

const LINKING = [
  'See [[Plan]], [[Plan#Goals]], [[Plan#Goals|the goals]], [[ Plan | alias ]] and [[Plan.md]].',
  'Paths: [[notes/Plan]], [[notes/Plan#Goals|goals]]. Markdown: [x](Plan.md), [y](./Plan.md).',
  'Others: [[Planning]], [[Plan B]], [z](Planning.md), [[Planning#Plan]].',
].join('\n');

const RENAMED = [
  'See [[Roadmap]], [[Roadmap#Goals]], [[Roadmap#Goals|the goals]], [[ Roadmap | alias ]] and [[Roadmap.md]].',
  'Paths: [[notes/Roadmap]], [[notes/Roadmap#Goals|goals]]. Markdown: [x](Roadmap.md), [y](./Roadmap.md).',
  'Others: [[Planning]], [[Plan B]], [z](Planning.md), [[Planning#Plan]].',
].join('\n');

describe('LinkIndexService — rename link rewriting', () => {
  beforeEach(async () => {
    await save('notes/Plan.md', '# Plan');
    await save('notes/Planning.md', '# Planning');
    await save('notes/Plan B.md', '# Plan B');
  });

  it('rewrites exactly the links to the renamed note in a closed note', async () => {
    await save('notes/index.md', LINKING);

    await rename('notes/Plan.md', 'notes/Roadmap.md');

    assert.equal(files.get('notes/index.md'), RENAMED);
    const R = 'notes/Roadmap.md';
    assert.deepEqual(await targetsFrom('notes/index.md'), [
      R, R, R, R, R,
      R, R, R, R,
      'notes/Planning.md', 'notes/Plan B.md', 'notes/Planning.md', 'notes/Planning.md',
    ]);
  });

  it('rewrites exactly the links to the renamed note in an open note', async () => {
    await save('notes/index.md', LINKING);
    ot.sessionManager.getOrCreateSession('notes/index.md', LINKING);

    await rename('notes/Plan.md', 'notes/Roadmap.md');

    assert.equal(ot.sessionManager.getContent('notes/index.md'), RENAMED);
    assert.equal(files.get('notes/index.md'), LINKING, 'an open note changes through OT, not on disk');
    assert.deepEqual(broadcasts, ['notes/index.md']);
  });

  it('rewrites links in table cells, keeping their escaped alias pipe', async () => {
    const table = '| Doc | Notes |\n| --- | --- |\n| [[Plan\\|the plan]] | [[Plan#Goals\\|goals]], [[Planning\\|other]] |';
    await save('notes/index.md', table);
    assert.deepEqual(await targetsFrom('notes/index.md'), ['notes/Plan.md', 'notes/Plan.md', 'notes/Planning.md']);

    await rename('notes/Plan.md', 'notes/Roadmap.md');

    assert.equal(
      files.get('notes/index.md'),
      '| Doc | Notes |\n| --- | --- |\n| [[Roadmap\\|the plan]] | [[Roadmap#Goals\\|goals]], [[Planning\\|other]] |',
    );
    assert.deepEqual(await targetsFrom('notes/index.md'), ['notes/Roadmap.md', 'notes/Roadmap.md', 'notes/Planning.md']);
  });

  it('keeps path-style links pointing at a note moved to another folder', async () => {
    await save('notes/index.md', 'See [[Plan]], [[notes/Plan#Goals]] and [x](Plan.md).');
    await save('other/list.md', 'See [p](../notes/Plan.md).');

    await rename('notes/Plan.md', 'archive/Plan.md');

    assert.equal(files.get('notes/index.md'), 'See [[Plan]], [[archive/Plan#Goals]] and [x](../archive/Plan.md).');
    assert.equal(files.get('other/list.md'), 'See [p](../archive/Plan.md).');
    assert.deepEqual(await targetsFrom('notes/index.md'), ['archive/Plan.md', 'archive/Plan.md', 'archive/Plan.md']);
  });

  it('writes a path when the new name alone would reach another note', async () => {
    await save('elsewhere/Roadmap.md', '# Another roadmap');
    await save('elsewhere/index.md', 'See [[Plan|the plan]].');
    await save('docs/index.md', 'See [[Plan]].');

    await rename('notes/Plan.md', 'notes/Roadmap.md');

    // [[Roadmap]] would reach the note next to it…
    assert.equal(files.get('elsewhere/index.md'), 'See [[notes/Roadmap|the plan]].');
    // …and, from a third folder, whichever same-named note comes first.
    assert.equal(files.get('docs/index.md'), 'See [[notes/Roadmap]].');
    assert.deepEqual(await targetsFrom('elsewhere/index.md'), ['notes/Roadmap.md']);
    assert.deepEqual(await targetsFrom('docs/index.md'), ['notes/Roadmap.md']);
  });

  it("follows the renamed note's links to itself", async () => {
    await save('notes/Plan.md', '# Plan\nSee [[Plan#Goals]] and [[#Goals]].');

    await rename('notes/Plan.md', 'notes/Roadmap.md');

    assert.equal(files.get('notes/Roadmap.md'), '# Plan\nSee [[Roadmap#Goals]] and [[#Goals]].');
  });

  it('resolves links that already named the new path', async () => {
    await save('notes/index.md', 'See [[Roadmap]].');
    assert.deepEqual(await targetsFrom('notes/index.md'), [null]);

    await rename('notes/Plan.md', 'notes/Roadmap.md');

    assert.equal(files.get('notes/index.md'), 'See [[Roadmap]].');
    assert.deepEqual(await targetsFrom('notes/index.md'), ['notes/Roadmap.md']);
  });
});
