import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { FileChangeEvent, FileEntry } from '@kalepin/shared';
import { NoteLink } from '../entities';
import { LinkIndexService } from './link-index.service';

const ALICE = '_users/alice@example.com';

let ds: DataSource;
let files: Map<string, string>;
let services: LinkIndexService[];

/** The nested listing `storage.list(root)` returns for the files under `root`. */
function listing(root: string): FileEntry[] {
  const top: FileEntry[] = [];
  const prefix = root ? root + '/' : '';
  for (const p of [...files.keys()].sort()) {
    if (!p.startsWith(prefix) || (!root && p.startsWith('_users/'))) continue;
    let level = top;
    const segments = p.slice(prefix.length).split('/');
    segments.forEach((name, i) => {
      const entryPath = prefix + segments.slice(0, i + 1).join('/');
      if (i === segments.length - 1) {
        level.push({ name, path: entryPath, type: 'file' });
        return;
      }
      let dir = level.find((e) => e.path === entryPath);
      if (!dir) {
        dir = { name, path: entryPath, type: 'directory', children: [] };
        level.push(dir);
      }
      level = dir.children!;
    });
  }
  return top;
}

interface Booted {
  svc: LinkIndexService;
  internalWrite: (notePath: string, content: string) => Promise<void>;
  personalChange: (event: FileChangeEvent) => Promise<void>;
}

async function boot(): Promise<Booted> {
  const storage = {
    async list(root: string) { return listing(root); },
    async read(p: string) {
      const content = files.get(p);
      if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return content;
    },
  };
  const booted = {} as Booted;
  const fileWatcher = {
    onFileChange() {},
    onPersonalChange(cb: any) { booted.personalChange = cb; },
    onInternalWrite(cb: any) { booted.internalWrite = cb; },
  };
  booted.svc = new LinkIndexService(ds.getRepository(NoteLink), storage as any, ds, fileWatcher as any);
  services.push(booted.svc);
  await booted.svc.onModuleInit();
  return booted;
}

async function targetsFrom(sourcePath: string): Promise<(string | null)[]> {
  const rows = await ds.getRepository(NoteLink).find({ where: { sourcePath }, order: { id: 'ASC' } });
  return rows.map((r) => r.targetPath);
}

beforeEach(async () => {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [NoteLink], synchronize: true });
  await ds.initialize();
  await ds.query(`CREATE TABLE users (email TEXT)`);
  await ds.query(`INSERT INTO users (email) VALUES ('alice@example.com'), ('bob@example.com')`);
  files = new Map([
    ['Notes/Plan.md', '# Shared plan'],
    ['Notes/index.md', 'See [[Plan]].'],
    [`${ALICE}/Plan.md`, '# My plan'],
    [`${ALICE}/todo.md`, 'See [[Plan]] and [[Secret]].'],
    [`${ALICE}/_secure/Secret.md`, 'ciphertext [[Plan]]'],
    [`${ALICE}/.trash/Old.md`, 'See [[Plan]].'],
  ]);
  services = [];
});

afterEach(async () => {
  for (const svc of services) clearInterval((svc as any).healSweepTimer);
  if (ds?.isInitialized) await ds.destroy();
});

describe('LinkIndexService — personal folders', () => {
  it('indexes personal notes at boot, never end-to-end encrypted ones', async () => {
    await boot();
    assert.deepEqual(await targetsFrom(`${ALICE}/todo.md`), [`${ALICE}/Plan.md`, null]);
    assert.deepEqual(await targetsFrom('Notes/index.md'), ['Notes/Plan.md']);
    assert.deepEqual(await targetsFrom(`${ALICE}/_secure/Secret.md`), []);
    assert.deepEqual(await targetsFrom(`${ALICE}/.trash/Old.md`), []);
  });

  it('resolves links in personal notes written after a restart', async () => {
    await boot();
    const { internalWrite } = await boot();
    files.set(`${ALICE}/new.md`, 'See [[Plan]].');
    await internalWrite(`${ALICE}/new.md`, 'See [[Plan]].');
    assert.deepEqual(await targetsFrom(`${ALICE}/new.md`), [`${ALICE}/Plan.md`]);
  });

  it('follows personal notes changed and deleted outside Kalepin', async () => {
    const { personalChange } = await boot();

    files.set(`${ALICE}/todo.md`, 'See [[todo]].');
    await personalChange({ event: 'change', path: `${ALICE}/todo.md` });
    assert.deepEqual(await targetsFrom(`${ALICE}/todo.md`), [`${ALICE}/todo.md`]);

    files.delete(`${ALICE}/todo.md`);
    await personalChange({ event: 'unlink', path: `${ALICE}/todo.md` });
    assert.deepEqual(await targetsFrom(`${ALICE}/todo.md`), []);
  });

  it('never indexes an end-to-end encrypted note written through Kalepin', async () => {
    const { internalWrite } = await boot();
    await internalWrite(`${ALICE}/_secure/Other.md`, 'See [[Plan]].');
    await internalWrite(`${ALICE}/note.md`, 'See [[Other]].');
    assert.deepEqual(await targetsFrom(`${ALICE}/_secure/Other.md`), []);
    assert.deepEqual(await targetsFrom(`${ALICE}/note.md`), [null]);
  });

  it('rebuilds an index made under older rules', async () => {
    // Rows an older index holds: a shared note resolved to a personal note.
    await ds.getRepository(NoteLink).save([
      Object.assign(new NoteLink(), {
        sourcePath: 'Notes/index.md', targetPath: `${ALICE}/Plan.md`, rawTarget: 'Plan',
        linkType: 'wikilink', lineNumber: 1, context: 'See [[Plan]].',
      }),
      Object.assign(new NoteLink(), {
        sourcePath: 'Notes/gone.md', targetPath: 'Notes/Plan.md', rawTarget: 'Plan',
        linkType: 'wikilink', lineNumber: 1, context: 'See [[Plan]].',
      }),
    ]);

    await boot();

    assert.deepEqual(await targetsFrom('Notes/index.md'), ['Notes/Plan.md']);
    assert.deepEqual(await targetsFrom('Notes/gone.md'), []);

    // The next boot keeps the rebuilt index.
    await ds.getRepository(NoteLink).update({ sourcePath: 'Notes/index.md' }, { lineNumber: 7 });
    await boot();
    const [row] = await ds.getRepository(NoteLink).find({ where: { sourcePath: 'Notes/index.md' } });
    assert.equal(row.lineNumber, 7);
  });
});
