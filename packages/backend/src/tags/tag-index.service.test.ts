import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { FileChangeEvent, FileEntry } from '@kalepin/shared';
import { NoteTag } from '../entities/note-tag.entity';
import type { MoveHooks } from '../files/files.service';
import { TagIndexService, TAG_PARSER_VERSION } from './tag-index.service';
import { TagsController } from './tags.controller';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ALICE_ROOT = `_users/${ALICE}`;

/** In-memory storage that lists like RoutingStorageAdapter: '' is the shared vault only. */
class StubStorage {
  files = new Map<string, string>();
  mtimes = new Map<string, number>();
  reads: string[] = [];
  private clock = 1_000;

  put(p: string, content: string, mtime?: number): void {
    this.files.set(p, content);
    this.mtimes.set(p, mtime ?? ++this.clock);
  }

  remove(p: string): void {
    this.files.delete(p);
    this.mtimes.delete(p);
  }

  async read(p: string): Promise<string> {
    this.reads.push(p);
    const c = this.files.get(p);
    if (c === undefined) throw Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
    return c;
  }

  async stat(p: string): Promise<{ mtime: Date }> {
    const m = this.mtimes.get(p);
    if (m === undefined) throw Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
    return { mtime: new Date(m) };
  }

  async list(root: string): Promise<FileEntry[]> {
    const prefix = root ? `${root}/` : '';
    const paths = [...this.files.keys()].filter((p) =>
      root ? p.startsWith(prefix) : !p.startsWith('_users/'),
    );
    return buildTree(paths.map((p) => p.slice(prefix.length)), prefix);
  }
}

function buildTree(relPaths: string[], prefix: string): FileEntry[] {
  const dirs = new Map<string, string[]>();
  const out: FileEntry[] = [];
  for (const rel of relPaths) {
    const slash = rel.indexOf('/');
    if (slash === -1) {
      out.push({ name: rel, path: prefix + rel, type: 'file' });
    } else {
      const dir = rel.slice(0, slash);
      dirs.set(dir, [...(dirs.get(dir) ?? []), rel.slice(slash + 1)]);
    }
  }
  for (const [dir, children] of dirs) {
    out.push({ name: dir, path: prefix + dir, type: 'directory', children: buildTree(children, `${prefix}${dir}/`) });
  }
  return out;
}

class StubWatcher {
  shared: ((e: FileChangeEvent) => void)[] = [];
  personal: ((e: FileChangeEvent) => void)[] = [];
  internal: ((p: string, c: string) => void | Promise<void>)[] = [];
  onFileChange(cb: (e: FileChangeEvent) => void) { this.shared.push(cb); }
  onPersonalChange(cb: (e: FileChangeEvent) => void) { this.personal.push(cb); }
  onInternalWrite(cb: (p: string, c: string) => void | Promise<void>) { this.internal.push(cb); }
  emit(event: FileChangeEvent) {
    const list = event.path.startsWith('_users/') ? this.personal : this.shared;
    for (const cb of list) cb(event);
  }
  async write(p: string, c: string) {
    for (const cb of this.internal) await cb(p, c);
  }
}

class StubFilesService {
  hooks: MoveHooks[] = [];
  registerMoveHooks(h: MoveHooks) { this.hooks.push(h); }
  async afterMove(src: string, dest: string) {
    for (const h of this.hooks) await h.afterMove?.(src, dest);
  }
}

let ds: DataSource;
let storage: StubStorage;
let watcher: StubWatcher;
let files: StubFilesService;
let grants: Map<string, Set<string>>;
let svc: TagIndexService;

async function boot(): Promise<TagIndexService> {
  const s = new TagIndexService(
    ds,
    storage as any,
    watcher as any,
    files as any,
    undefined, // predicates: falls back to isE2EPath
    { visibleGrantSet: async (email: string) => grants.get(email) ?? new Set<string>() } as any,
  );
  await s.onModuleInit();
  return s;
}

/** Let watcher callbacks (fire-and-forget) and the write chain settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

async function rows(): Promise<string[]> {
  const r: { path: string; tag: string }[] = await ds.query(`SELECT path, tag FROM note_tags ORDER BY path, tag`);
  return r.map((x) => `${x.path}#${x.tag}`);
}

async function metaPaths(): Promise<string[]> {
  const r: { path: string }[] = await ds.query(`SELECT path FROM note_tags_meta ORDER BY path`);
  return r.map((x) => x.path);
}

const counts = async (email?: string) =>
  Object.fromEntries((await svc.listTags(email)).map((t) => [t.tag, t.count]));

beforeEach(async () => {
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [NoteTag], synchronize: true });
  await ds.initialize();
  await ds.query(`CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR UNIQUE)`);
  storage = new StubStorage();
  watcher = new StubWatcher();
  files = new StubFilesService();
  grants = new Map();
});

afterEach(async () => {
  svc?.onModuleDestroy();
  await ds.destroy();
});

describe('TagIndexService — boot backfill', () => {
  it('indexes the shared vault and every personal folder, skipping _secure', async () => {
    await ds.query(`INSERT INTO users (email) VALUES (?), (?)`, [ALICE, BOB]);
    storage.put('Notes/a.md', '#shared');
    storage.put(`${ALICE_ROOT}/diary.md`, '---\ntags: [private]\n---\n');
    storage.put(`${ALICE_ROOT}/_secure/vault.md`, 'ENVELOPE #leak');
    storage.put(`_users/${BOB}/todo.md`, '#bobs');
    storage.put('Notes/readme.txt', '#notmarkdown');
    svc = await boot();

    assert.deepEqual(await rows(), [
      'Notes/a.md#shared',
      `${ALICE_ROOT}/diary.md#private`,
      `_users/${BOB}/todo.md#bobs`,
    ]);
    assert.ok(!storage.reads.some((p) => p.includes('/_secure/')), 'secure files must never be read');
  });

  it('does not rescan when the index is current, but does after a parser version bump', async () => {
    storage.put('Notes/a.md', '#one');
    svc = await boot();
    svc.onModuleDestroy();

    storage.reads = [];
    svc = await boot();
    assert.deepEqual(storage.reads, [], 'current index: no rescan');
    svc.onModuleDestroy();

    await ds.query(`UPDATE note_tags_meta SET parser_version = ?`, [TAG_PARSER_VERSION - 1]);
    storage.put('Notes/b.md', '#two');
    svc = await boot();
    assert.deepEqual(await rows(), ['Notes/a.md#one', 'Notes/b.md#two']);
  });

  it('records a meta row for untagged notes', async () => {
    storage.put('Notes/plain.md', 'no tags here');
    svc = await boot();
    assert.deepEqual(await rows(), []);
    assert.deepEqual(await metaPaths(), ['Notes/plain.md']);
  });
});

describe('TagIndexService — incremental maintenance', () => {
  beforeEach(async () => {
    svc = await boot();
  });

  it('indexes internal writes and replaces tags on the next save', async () => {
    await watcher.write('Notes/a.md', '#old #keep');
    assert.deepEqual(await rows(), ['Notes/a.md#keep', 'Notes/a.md#old']);
    await watcher.write('Notes/a.md', '#new #keep');
    assert.deepEqual(await rows(), ['Notes/a.md#keep', 'Notes/a.md#new']);
  });

  it('ignores non-markdown internal writes', async () => {
    await watcher.write('Notes/data.json', '#x');
    assert.deepEqual(await rows(), []);
  });

  it('indexes shared and personal watcher add/change events', async () => {
    storage.put('Notes/a.md', '#ext');
    watcher.emit({ event: 'add', path: 'Notes/a.md' });
    storage.put(`${ALICE_ROOT}/p.md`, '#mine');
    watcher.emit({ event: 'add', path: `${ALICE_ROOT}/p.md` });
    await settle();
    assert.deepEqual(await rows(), ['Notes/a.md#ext', `${ALICE_ROOT}/p.md#mine`]);

    storage.put('Notes/a.md', '#edited');
    watcher.emit({ event: 'change', path: 'Notes/a.md' });
    await settle();
    assert.deepEqual(await rows(), ['Notes/a.md#edited', `${ALICE_ROOT}/p.md#mine`]);
  });

  it('drops rows and meta on unlink (delete or move into .trash/)', async () => {
    await watcher.write('Notes/a.md', '#gone');
    storage.remove('Notes/a.md');
    watcher.emit({ event: 'unlink', path: 'Notes/a.md' });
    await settle();
    assert.deepEqual(await rows(), []);
    assert.deepEqual(await metaPaths(), []);
  });

  it('drops every row under a folder on unlinkDir', async () => {
    await watcher.write('Projects/a.md', '#x');
    await watcher.write('Projects/sub/b.md', '#y');
    await watcher.write('Projects-old/c.md', '#z');
    watcher.emit({ event: 'unlinkDir', path: 'Projects' });
    await settle();
    assert.deepEqual(await rows(), ['Projects-old/c.md#z']);
  });

  it('never indexes _secure paths, and purges rows if a path becomes E2E', async () => {
    const secure = `${ALICE_ROOT}/_secure/diary.md`;
    await watcher.write(secure, '#secret');
    storage.put(secure, '#secret');
    watcher.emit({ event: 'change', path: secure });
    await settle();
    assert.deepEqual(await rows(), []);
    assert.ok(!storage.reads.includes(secure), 'secure path must not be read');

    await ds.query(`INSERT INTO note_tags (path, tag, display) VALUES (?, 'stale', 'stale')`, [secure]);
    await svc.indexFile(secure, '#secret');
    assert.deepEqual(await rows(), []);
  });

  it('never indexes dot-folders', async () => {
    await watcher.write('.trash/old.md', '#trashed');
    assert.deepEqual(await rows(), []);
  });

  it('serialises overlapping writes to the same note', async () => {
    await Promise.all([
      svc.indexFile('Notes/a.md', '#first'),
      svc.indexFile('Notes/a.md', '#second'),
      svc.indexFile('Notes/a.md', '#third'),
    ]);
    assert.deepEqual(await rows(), ['Notes/a.md#third']);
  });
});

describe('TagIndexService — moves', () => {
  beforeEach(async () => {
    svc = await boot();
  });

  it('follows a file rename', async () => {
    await watcher.write('Notes/a.md', '#x');
    storage.remove('Notes/a.md');
    storage.put('Notes/b.md', '#x');
    await files.afterMove('Notes/a.md', 'Notes/b.md');
    assert.deepEqual(await rows(), ['Notes/b.md#x']);
    assert.deepEqual(await metaPaths(), ['Notes/b.md']);
  });

  it('follows a folder move, rewriting the whole prefix only', async () => {
    await watcher.write('Projects/a.md', '#x');
    await watcher.write('Projects/sub/b.md', '#y');
    await watcher.write('Projects-old/c.md', '#z');
    await files.afterMove('Projects', 'Archive/Projects');
    assert.deepEqual(await rows(), [
      'Archive/Projects/a.md#x',
      'Archive/Projects/sub/b.md#y',
      'Projects-old/c.md#z',
    ]);
  });

  it('escapes LIKE wildcards in folder names', async () => {
    await watcher.write('a_b/x.md', '#one');
    await watcher.write('axb/y.md', '#two');
    await files.afterMove('a_b', 'moved');
    assert.deepEqual(await rows(), ['axb/y.md#two', 'moved/x.md#one']);
  });

  it('drops rows when a note moves into .trash/ or _secure', async () => {
    await watcher.write('Notes/a.md', '#x');
    await watcher.write(`${ALICE_ROOT}/b.md`, '#y');
    await files.afterMove('Notes/a.md', '.trash/a.md');
    await files.afterMove(`${ALICE_ROOT}/b.md`, `${ALICE_ROOT}/_secure/b.md`);
    assert.deepEqual(await rows(), []);
    assert.deepEqual(await metaPaths(), []);
  });

  it('drops rows when a folder moves into _secure', async () => {
    await watcher.write(`${ALICE_ROOT}/work/a.md`, '#x');
    await files.afterMove(`${ALICE_ROOT}/work`, `${ALICE_ROOT}/_secure/work`);
    assert.deepEqual(await rows(), []);
  });

  it('indexes a note restored from a non-indexed location', async () => {
    storage.put('Notes/back.md', '#restored');
    await files.afterMove('.trash/back.md', 'Notes/back.md');
    assert.deepEqual(await rows(), ['Notes/back.md#restored']);
  });
});

describe('TagIndexService — heal sweep', () => {
  it('re-indexes drifted notes and drops deleted ones', async () => {
    storage.put('Notes/a.md', '#before', 100);
    storage.put('Notes/b.md', '#doomed', 100);
    svc = await boot();

    storage.put('Notes/a.md', '#after', 200); // external edit the watcher missed
    storage.remove('Notes/b.md'); // external delete the watcher missed
    const result = await svc.healSweep();

    assert.deepEqual(result, { reindexed: 1, removed: 1 });
    assert.deepEqual(await rows(), ['Notes/a.md#after']);
  });
});

describe('TagIndexService — queries', () => {
  beforeEach(async () => {
    svc = await boot();
  });

  it('counts nested tags toward their parents, once per note', async () => {
    await watcher.write('A.md', '#project');
    await watcher.write('B.md', '#project/kalepin');
    await watcher.write('C.md', '#project/kalepin #project');
    await watcher.write('D.md', '#projects');
    assert.deepEqual(await svc.listTags(), [
      { tag: 'project', count: 3 },
      { tag: 'project/kalepin', count: 2 },
      { tag: 'projects', count: 1 },
    ]);
  });

  it('matches case-insensitively and shows the most frequent casing', async () => {
    await watcher.write('A.md', '#Project');
    await watcher.write('B.md', '#project');
    await watcher.write('C.md', '#Project/Kalepin');
    assert.deepEqual(await svc.listTags(), [
      { tag: 'Project', count: 3 },
      { tag: 'Project/Kalepin', count: 1 },
    ]);
  });

  it('breaks display ties by code-point order', async () => {
    await watcher.write('A.md', '#beta');
    await watcher.write('B.md', '#Beta');
    assert.deepEqual(await svc.listTags(), [{ tag: 'Beta', count: 2 }]);
  });

  it('isolates personal tags and honours grants', async () => {
    await watcher.write('Notes/shared.md', '#team');
    await watcher.write(`${ALICE_ROOT}/plan.md`, '#secret-plan #team');
    await watcher.write(`${ALICE_ROOT}/review.md`, '#review');
    await watcher.write(`_users/${BOB}/mine.md`, '#bob-only');

    assert.deepEqual(await counts(ALICE), { 'secret-plan': 1, review: 1, team: 2 });
    assert.deepEqual(await counts(BOB), { 'bob-only': 1, team: 1 });

    grants.set(BOB, new Set([`${ALICE_ROOT}/review.md`]));
    assert.deepEqual(await counts(BOB), { 'bob-only': 1, review: 1, team: 1 });
  });

  it('lists the notes carrying a tag or a child, most recent first', async () => {
    storage.put('Old.md', '', 100);
    storage.put('New.md', '', 300);
    storage.put('Mid.md', '', 200);
    storage.put('Other.md', '', 400);
    await watcher.write('Old.md', '#project');
    await watcher.write('New.md', '#project/kalepin');
    await watcher.write('Mid.md', '#Project');
    await watcher.write('Other.md', '#projects');

    const notes = await svc.notesForTags(['PROJECT']);
    assert.deepEqual(notes.map((n) => n.path), ['New.md', 'Mid.md', 'Old.md']);
    assert.deepEqual(notes[0], { path: 'New.md', title: 'New', modifiedAt: new Date(300).toISOString() });
    assert.deepEqual((await svc.notesForTags(['project/kalepin'])).map((n) => n.path), ['New.md']);
    assert.deepEqual((await svc.notesForTags(['#project/'])).map((n) => n.path), ['New.md', 'Mid.md', 'Old.md']);
  });

  it('does not list foreign personal notes', async () => {
    await watcher.write(`${ALICE_ROOT}/plan.md`, '#plan');
    await watcher.write('Notes/plan.md', '#plan');
    assert.deepEqual((await svc.notesForTags(['plan'], BOB)).map((n) => n.path), ['Notes/plan.md']);
    assert.equal((await svc.notesForTags(['plan'], ALICE)).length, 2);
  });

  it('ANDs several tags', async () => {
    await watcher.write('A.md', '#x #y/z');
    await watcher.write('B.md', '#x');
    assert.deepEqual([...(await svc.pathsWithAllTags(['x', 'y']))], ['A.md']);
    assert.deepEqual([...(await svc.pathsWithAllTags(['x', 'nope']))], []);
    assert.deepEqual([...(await svc.pathsWithAllTags([]))], []);
  });

  it('does not treat _ or % in a tag as LIKE wildcards', async () => {
    await watcher.write('A.md', '#a_b/c');
    await watcher.write('B.md', '#axb/c');
    assert.deepEqual([...(await svc.pathsWithAllTags(['a_b']))], ['A.md']);
  });
});

describe('TagsController', () => {
  beforeEach(async () => {
    svc = await boot();
  });

  it('scopes both endpoints to the caller', async () => {
    await watcher.write(`${ALICE_ROOT}/x.md`, '#mine');
    const ctrl = new TagsController(svc);
    assert.deepEqual(await ctrl.list({ user: { sub: 1, email: ALICE } as any }), [{ tag: 'mine', count: 1 }]);
    assert.deepEqual(await ctrl.list({ user: { sub: 2, email: BOB } as any }), []);
    assert.equal((await ctrl.notes({ user: { sub: 1, email: ALICE } as any }, 'mine')).length, 1);
    assert.equal((await ctrl.notes({ user: { sub: 2, email: BOB } as any }, 'mine')).length, 0);
  });

  it('rejects a missing or empty tag', async () => {
    const ctrl = new TagsController(svc);
    const req = { user: { sub: 1, email: ALICE } as any };
    await assert.rejects(() => ctrl.notes(req, undefined), BadRequestException);
    await assert.rejects(() => ctrl.notes(req, '#'), BadRequestException);
  });
});
