import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { FileChangeEvent } from '@kalepin/shared';
import { NoteLink } from '../entities';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { FilesService } from '../files/files.service';
import { LinkIndexService } from './link-index.service';

let tmpRoot: string;
let storage: LocalFSAdapter;
let ds: DataSource;
let links: LinkIndexService;
let files: FilesService;
let internalWrite: (notePath: string, content: string) => Promise<void>;
let fileChange: (event: FileChangeEvent) => Promise<void>;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-link-move-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  const vault = await fs.mkdtemp(path.join(tmpRoot, 'vault-'));
  storage = new LocalFSAdapter(vault);
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [NoteLink], synchronize: true });
  await ds.initialize();
  await ds.query(`CREATE TABLE note_changes (path TEXT, action TEXT, createdAt TEXT)`); // read by the graph
  const fileWatcher = {
    onFileChange(cb: typeof fileChange) { fileChange = cb; },
    onPersonalChange() {},
    onInternalWrite(cb: typeof internalWrite) { internalWrite = cb; },
  };
  links = new LinkIndexService(ds.getRepository(NoteLink), storage, ds, fileWatcher as any);
  await links.onModuleInit();
  files = new FilesService(storage, undefined, links);
});

afterEach(async () => {
  clearInterval((links as any).healSweepTimer);
  if (ds?.isInitialized) await ds.destroy();
});

async function save(notePath: string, content: string): Promise<void> {
  await storage.write(notePath, content);
  await internalWrite(notePath, content);
}

async function targetsFrom(sourcePath: string): Promise<(string | null)[]> {
  const rows = await ds.getRepository(NoteLink).find({ where: { sourcePath }, order: { id: 'ASC' } });
  return rows.map((r) => r.targetPath);
}

describe('LinkIndexService — folder moves', () => {
  it('keeps links to the notes of a renamed folder', async () => {
    await save('Projects/Plan.md', '# Plan');
    await save('Projects/sub/Spec.md', 'See [[Plan]] and [[Projects/Plan#Goals]].');
    await save('Other/Planning.md', '# Planning');
    await save('index.md', [
      'Notes: [[Plan]], [[Projects/Plan|plan]], [[Projects/sub/Spec]], [[Planning]].',
      'Markdown: [spec](Projects/sub/Spec.md).',
    ].join('\n'));

    await files.move('Projects', 'Archive');

    assert.equal(await storage.read('index.md'), [
      'Notes: [[Plan]], [[Archive/Plan|plan]], [[Archive/sub/Spec]], [[Planning]].',
      'Markdown: [spec](Archive/sub/Spec.md).',
    ].join('\n'));
    assert.equal(await storage.read('Archive/sub/Spec.md'), 'See [[Plan]] and [[Archive/Plan#Goals]].');
    assert.deepEqual(await targetsFrom('index.md'), [
      'Archive/Plan.md', 'Archive/Plan.md', 'Archive/sub/Spec.md', 'Other/Planning.md', 'Archive/sub/Spec.md',
    ]);

    // The watcher then reports the moved notes at their new place.
    for (const p of ['Projects/Plan.md', 'Projects/sub/Spec.md']) await fileChange({ event: 'unlink', path: p });
    for (const p of ['Archive/Plan.md', 'Archive/sub/Spec.md']) await fileChange({ event: 'add', path: p });

    const backlinks = (await links.getBacklinks('Archive/Plan.md')).map((b) => b.sourcePath).sort();
    assert.deepEqual(backlinks, ['Archive/sub/Spec.md', 'Archive/sub/Spec.md', 'index.md', 'index.md']);
    const graph = await links.getGraphData();
    const nodes = graph.nodes.map((n) => n.path);
    assert.ok(!nodes.some((p) => p.startsWith('Projects/')), `stale nodes: ${nodes.join(', ')}`);
    assert.ok(!graph.edges.some((e) => e.target.startsWith('Projects/') || e.source.startsWith('Projects/')));
  });
});
