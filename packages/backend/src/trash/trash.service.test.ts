import 'reflect-metadata';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from '../files/files.service';
import { FileWatcherService } from '../files/file-watcher.service';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { ShareLinksService } from '../share-links/share-links.service';
import { StarsService } from '../stars/stars.service';
import { PinService } from '../pin/pin.service';
import { ChangeTrackingService } from '../changes/change-tracking.service';
import {
  TrashItem,
  StarredItem,
  NoteMeta,
  DocHandle,
  ShortLink,
  DocumentGrant,
  NoteChange,
  NoteSnapshot,
  User,
} from '../entities';
import { isVisibleTo } from '../auth/visibility';
import { TrashService } from './trash.service';
import { trashRetentionDays } from './trash-retention.service';
import { restoredName, trashPathFor } from './trash-paths';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ADMIN = 'admin@example.com';
const ALICE_ROOT = `_users/${ALICE}`;

const passthroughPredicates = {
  isEncryptedAtRest: () => false,
  isE2EEncrypted: (p: string) => p.includes('/_secure/') || p.endsWith('/_secure'),
  shouldIndexPlaintext: () => true,
  canCollab: () => true,
  commentBodiesEncrypted: () => false,
  shareLinkMintable: () => true,
} as any;

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let storage: RoutingStorageAdapter;
let ds: DataSource;
let changeRepo: Repository<NoteChange>;
let trashRepo: Repository<TrashItem>;
let starRepo: Repository<StarredItem>;
let grants: GrantsService;
let docHandles: DocHandlesService;
let shareLinks: ShareLinksService;
let stars: StarsService;
let pins: PinService;
let watcher: FileWatcherService;
let files: FilesService;
let trash: TrashService;
let prevAdmins: string | undefined;

/** Let fire-and-forget change tracking land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));
}

async function changesFor(p: string): Promise<string[]> {
  const rows = await changeRepo.find({ where: { path: p }, order: { id: 'ASC' } });
  return rows.map((r) => r.action);
}

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-trash-'));
  prevAdmins = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = ADMIN;
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
  if (prevAdmins === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = prevAdmins;
});

beforeEach(async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sharedRoot = path.join(tmpRoot, `vault-${run}`);
  personalRoot = path.join(tmpRoot, `personal-${run}`);
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  storage = new RoutingStorageAdapter(new LocalFSAdapter(sharedRoot), new LocalFSAdapter(personalRoot));
  await storage.ensurePersonalFolder(ALICE);
  await storage.ensurePersonalFolder(BOB);

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [TrashItem, StarredItem, NoteMeta, DocHandle, ShortLink, DocumentGrant, NoteChange, NoteSnapshot, User],
    synchronize: true,
  });
  await ds.initialize();
  changeRepo = ds.getRepository(NoteChange);
  trashRepo = ds.getRepository(TrashItem);
  starRepo = ds.getRepository(StarredItem);

  grants = new GrantsService(ds.getRepository(DocumentGrant));
  const visibility = new GrantAwareVisibility(grants);
  docHandles = new DocHandlesService(ds.getRepository(DocHandle));
  shareLinks = new ShareLinksService(ds.getRepository(ShortLink), storage, passthroughPredicates, docHandles);
  stars = new StarsService(starRepo);
  pins = new PinService(ds.getRepository(NoteMeta));
  const changeTracking = new ChangeTrackingService(
    changeRepo,
    ds.getRepository(NoteSnapshot),
    ds.getRepository(User),
    passthroughPredicates,
    visibility,
  );
  watcher = new FileWatcherService(storage);
  files = new FilesService(
    storage,
    changeTracking,
    undefined,
    undefined,
    shareLinks,
    undefined,
    visibility,
    grants,
    watcher,
    docHandles,
  );
  trash = new TrashService(
    storage,
    trashRepo,
    starRepo,
    ds.getRepository(NoteMeta),
    files,
    shareLinks,
    grants,
    docHandles,
    watcher,
    changeTracking,
  );
  trash.onModuleInit();
});

afterEach(async () => {
  await settle();
  if (ds?.isInitialized) await ds.destroy();
});

describe('Trash — delete moves to the zone trash', () => {
  it('moves a shared note and its comment sidecar to .trash/<id>/', async () => {
    await storage.write('Projects/Plan.md', '# Plan');
    await storage.write('Projects/.Plan.md.collab', '{"comments":{}}');

    const { trashItemId } = await files.deleteFile('Projects/Plan.md', 7, ALICE);
    assert.ok(trashItemId);
    const trashPath = trashPathFor('Projects/Plan.md', trashItemId!);
    assert.equal(trashPath, `.trash/${trashItemId}/Plan.md`);
    assert.equal(await storage.exists('Projects/Plan.md'), false);
    assert.equal(await storage.read(trashPath), '# Plan');
    assert.equal(await storage.exists(`.trash/${trashItemId}/.Plan.md.collab`), true);
    assert.equal(await storage.exists('Projects/.Plan.md.collab'), false);

    const row = await trashRepo.findOneByOrFail({ id: trashItemId! });
    assert.equal(row.originalPath, 'Projects/Plan.md');
    assert.equal(row.kind, 'file');
    assert.equal(row.zone, 'shared');
    assert.equal(row.ownerEmail, null);
    assert.equal(row.deletedByEmail, ALICE);
    assert.equal(row.deletedByUserId, 7);
    assert.equal(row.itemCount, 1);

    await settle();
    assert.deepEqual(await changesFor('Projects/Plan.md'), ['deleted']);
  });

  it('moves a personal folder into the owner trash and records one deleted change per note', async () => {
    await storage.write(`${ALICE_ROOT}/Drafts/a.md`, 'A');
    await storage.write(`${ALICE_ROOT}/Drafts/sub/b.md`, 'B');
    await storage.write(`${ALICE_ROOT}/Drafts/sub/pic.png`, 'png');

    const { trashItemId } = await files.deleteDirectory(`${ALICE_ROOT}/Drafts`, ALICE, 7);
    assert.ok(trashItemId);
    const base = `${ALICE_ROOT}/.trash/${trashItemId}/Drafts`;
    assert.equal(await storage.read(`${base}/a.md`), 'A');
    assert.equal(await storage.read(`${base}/sub/b.md`), 'B');
    assert.equal(await storage.exists(`${ALICE_ROOT}/Drafts`), false);

    const row = await trashRepo.findOneByOrFail({ id: trashItemId! });
    assert.equal(row.kind, 'folder');
    assert.equal(row.zone, 'personal');
    assert.equal(row.ownerEmail, ALICE);
    assert.equal(row.itemCount, 3);

    await settle();
    assert.deepEqual(await changesFor(`${ALICE_ROOT}/Drafts/a.md`), ['deleted']);
    assert.deepEqual(await changesFor(`${ALICE_ROOT}/Drafts/sub/b.md`), ['deleted']);
    assert.deepEqual(await changesFor(`${ALICE_ROOT}/Drafts/sub/pic.png`), []);
  });

  it('keeps two trashed notes with the same name apart', async () => {
    await storage.write('A/Plan.md', 'from A');
    await storage.write('B/Plan.md', 'from B');
    const a = (await files.deleteFile('A/Plan.md', undefined, ALICE)).trashItemId!;
    const b = (await files.deleteFile('B/Plan.md', undefined, ALICE)).trashItemId!;
    assert.notEqual(a, b);
    await trash.restore(a, { email: ALICE });
    await trash.restore(b, { email: ALICE });
    assert.equal(await storage.read('A/Plan.md'), 'from A');
    assert.equal(await storage.read('B/Plan.md'), 'from B');
  });

  it('hides trashed items from the tree', async () => {
    await storage.write('Keep.md', 'k');
    await storage.write('Gone.md', 'g');
    await files.deleteFile('Gone.md', undefined, ALICE);
    const tree = await files.listTree('', ALICE);
    const names = tree.map((e) => e.name);
    assert.ok(names.includes('Keep.md'));
    assert.ok(!names.includes('Gone.md'));
    assert.ok(!names.includes('.trash'));
  });

  it('marks the source as removed by Kalepin for rename tracking', async () => {
    await storage.write('Marked.md', 'm');
    await files.deleteFile('Marked.md', undefined, ALICE);
    assert.equal(watcher.isSelfRemoved('Marked.md'), true);
  });

  it('answers 404 for a missing path and refuses the personal root', async () => {
    await assert.rejects(files.deleteFile('nope.md', undefined, ALICE), NotFoundException);
    await assert.rejects(files.deleteDirectory(ALICE_ROOT, ALICE), BadRequestException);
    await assert.rejects(trash.trash('', { email: ALICE }), BadRequestException);
  });
});

describe('Trash — _secure paths are deleted permanently', () => {
  it('hard-deletes an E2E note and returns a null trash id', async () => {
    const p = `${ALICE_ROOT}/_secure/diary.md`;
    await storage.write(p, 'ciphertext');
    const { trashItemId } = await files.deleteFile(p, undefined, ALICE);
    assert.equal(trashItemId, null);
    assert.equal(await storage.exists(p), false);
    assert.equal(await trashRepo.count(), 0);
    assert.equal(await storage.exists(`${ALICE_ROOT}/.trash`), false);
  });
});

describe('Trash — trash paths are unreachable through the API', () => {
  it('denies trash paths in the visibility predicates', async () => {
    assert.equal(isVisibleTo('.trash/abc/Plan.md', ALICE), false);
    assert.equal(isVisibleTo('.trash', ALICE), false);
    assert.equal(isVisibleTo(`${ALICE_ROOT}/.trash/abc/x.md`, ALICE), false);
    assert.equal(isVisibleTo('notes/.trash-like.md', ALICE), true);
  });

  it('404s a direct read of a trashed note and a move into the trash folder', async () => {
    await storage.write('Plan.md', 'secret');
    const id = (await files.deleteFile('Plan.md', undefined, ALICE)).trashItemId!;
    await assert.rejects(files.readFile(`.trash/${id}/Plan.md`, ALICE), NotFoundException);

    await storage.write('Other.md', 'o');
    await assert.rejects(files.move('Other.md', '.trash/x/Other.md', ALICE), NotFoundException);
    await assert.rejects(files.createFile('.trash/new.md', 'x', undefined, undefined, ALICE), NotFoundException);
    assert.equal(await storage.read('Other.md'), 'o');
  });
});

describe('Trash — share links, grants, stars, PIN and handles are dormant', () => {
  it('keeps the same handle id: tombstoned while trashed, active after restore', async () => {
    await files.createFile('Plan.md', 'v1', undefined, undefined, ALICE);
    await settle();
    const handle = await docHandles.findOrCreateForPath('Plan.md');
    const id = (await files.deleteFile('Plan.md', undefined, ALICE)).trashItemId!;
    const trashed = await docHandles.resolve(handle);
    assert.equal(trashed.tombstoned, true);
    assert.equal(trashed.path, `.trash/${id}/Plan.md`);

    await trash.restore(id, { email: ALICE });
    const back = await docHandles.resolve(handle);
    assert.deepEqual(back, { path: 'Plan.md', tombstoned: false });
  });

  it('share link resolves as not found while trashed and revives on restore', async () => {
    await storage.write('Public.md', 'hello');
    const { code } = await shareLinks.mintExplicit({ path: 'Public.md', createdByEmail: ALICE });
    const id = (await files.deleteFile('Public.md', undefined, ALICE)).trashItemId!;
    assert.deepEqual(await shareLinks.resolve(code), { kind: 'not_found' });
    await trash.restore(id, { email: ALICE });
    assert.deepEqual(await shareLinks.resolve(code), { kind: 'ok', path: 'Public.md' });
  });

  it('grants vanish from the grantee lists without being revoked, then come back', async () => {
    const note = `${ALICE_ROOT}/Shared.md`;
    await storage.write(note, 'for bob');
    const grant = await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: note, permission: 'read' });
    const id = (await files.deleteFile(note, undefined, ALICE)).trashItemId!;

    assert.deepEqual(await files.listLiveGrantsForGrantee(BOB), []);
    assert.deepEqual(await grants.listForGrantor(ALICE), []);
    await settle();
    const row = await grants.findById(grant.id);
    assert.equal(row!.revokedAt, null, 'dormant grant must not be GC-revoked');
    await assert.rejects(files.readFile(row!.path, BOB), NotFoundException);

    await trash.restore(id, { email: ALICE });
    const live = await files.listLiveGrantsForGrantee(BOB);
    assert.deepEqual(live.map((g) => g.path), [note]);
    assert.equal(await files.readFile(note, BOB), 'for bob');
  });

  it('stars and the PIN follow the note into the trash and back', async () => {
    await storage.write('Starred.md', 's');
    await stars.addStar(1, 'file', 'Starred.md');
    await pins.setPin('Starred.md', 'correct-horse', ALICE);
    const id = (await files.deleteFile('Starred.md', undefined, ALICE)).trashItemId!;

    assert.deepEqual(await stars.listByUser(1), []);
    assert.equal(await pins.hasPin('Starred.md'), false);

    await trash.restore(id, { email: ALICE });
    assert.deepEqual((await stars.listByUser(1)).map((s) => s.path), ['Starred.md']);
    assert.equal(await pins.hasPin('Starred.md'), true);
  });

  it('a new note at the original path inherits nothing', async () => {
    await files.createFile('Plan.md', 'old', undefined, undefined, ALICE);
    await settle();
    const oldHandle = await docHandles.findOrCreateForPath('Plan.md');
    const { code } = await shareLinks.mintExplicit({ path: 'Plan.md', createdByEmail: ALICE });
    await pins.setPin('Plan.md', 'correct-horse', ALICE);
    await stars.addStar(1, 'file', 'Plan.md');
    await files.deleteFile('Plan.md', undefined, ALICE);

    await files.createFile('Plan.md', 'new', undefined, undefined, ALICE);
    await settle();
    const newHandle = await docHandles.findOrCreateForPath('Plan.md');
    assert.notEqual(newHandle, oldHandle);
    assert.deepEqual(await shareLinks.resolve(code), { kind: 'not_found' });
    assert.equal(await shareLinks.findByPath('Plan.md'), null);
    assert.equal(await pins.hasPin('Plan.md'), false);
    assert.deepEqual(await stars.listByUser(1), []);
  });
});

describe('Trash — LIKE wildcards in folder names never reach neighbours', () => {
  // `_` and `%` are LIKE wildcards: an unescaped `my_notes/%` also matches
  // `my-notes/…`, and `_users/john_doe@…` matches `_users/john.doe@…`.
  // Trash, restore and purge must leave every row of the neighbour alone.
  async function seedNeighbour(note: string, owner: string, grantee: string) {
    await storage.write(note, 'neighbour');
    const handle = await docHandles.findOrCreateForPath(note);
    const { code } = await shareLinks.mintExplicit({ path: note, createdByEmail: owner });
    const grant = await grants.mint({ grantorEmail: owner, granteeEmail: grantee, path: note, permission: 'read' });
    await stars.addStar(42, 'file', note);
    return { handle, code, grantId: grant.id };
  }

  async function assertUntouched(note: string, seeded: { handle: string; code: string; grantId: number }, step: string) {
    assert.deepEqual(await docHandles.resolve(seeded.handle), { path: note, tombstoned: false }, `${step}: handle`);
    assert.deepEqual(await shareLinks.resolve(seeded.code), { kind: 'ok', path: note }, `${step}: share link`);
    const grant = await grants.findById(seeded.grantId);
    assert.equal(grant!.path, note, `${step}: grant path`);
    assert.equal(grant!.revokedAt, null, `${step}: grant revoked`);
    assert.deepEqual((await stars.listByUser(42)).map((s) => s.path), [note], `${step}: star`);
  }

  async function trashRestoreTrashPurge(folder: string, actor: string) {
    const first = (await files.deleteDirectory(folder, actor)).trashItemId!;
    await settle();
    await trash.restore(first, { email: actor });
    await settle();
    const second = (await files.deleteDirectory(folder, actor)).trashItemId!;
    await settle();
    await trash.purge(second, actor);
    await settle();
    return { first, second };
  }

  it('`_` in a folder name: trashing my_notes leaves my-notes alone', async () => {
    const folder = `${ALICE_ROOT}/my_notes`;
    const neighbour = `${ALICE_ROOT}/my-notes/B.md`;
    await storage.write(`${folder}/A.md`, 'a');
    const own = await docHandles.findOrCreateForPath(`${folder}/A.md`);
    const seeded = await seedNeighbour(neighbour, ALICE, BOB);

    await files.deleteDirectory(folder, ALICE).then(async ({ trashItemId }) => {
      await settle();
      await assertUntouched(neighbour, seeded, 'trashed');
      // The escaped prefix still matches the folder's own notes.
      assert.deepEqual(await docHandles.resolve(own), {
        path: `${ALICE_ROOT}/.trash/${trashItemId}/my_notes/A.md`,
        tombstoned: true,
      });
      await trash.restore(trashItemId!, { email: ALICE });
    });
    await settle();
    await assertUntouched(neighbour, seeded, 'restored');
    assert.deepEqual(await docHandles.resolve(own), { path: `${folder}/A.md`, tombstoned: false });
    await trashRestoreTrashPurge(folder, ALICE);
    await assertUntouched(neighbour, seeded, 'purged');
  });

  it('`_` in an email: john_doe trashing a folder leaves john.doe alone', async () => {
    const JOHN_U = 'john_doe@example.com';
    const JOHN_D = 'john.doe@example.com';
    await storage.ensurePersonalFolder(JOHN_U);
    await storage.ensurePersonalFolder(JOHN_D);
    const folder = `_users/${JOHN_U}/Notes`;
    const neighbour = `_users/${JOHN_D}/Notes/Private.md`;
    await storage.write(`${folder}/Mine.md`, 'mine');
    const seeded = await seedNeighbour(neighbour, JOHN_D, BOB);

    await trashRestoreTrashPurge(folder, JOHN_U);
    await assertUntouched(neighbour, seeded, 'after trash/restore/purge');
  });

  it('`%` in a folder name: trashing "100%" leaves "100 percent" alone', async () => {
    const folder = `${ALICE_ROOT}/100%`;
    const neighbour = `${ALICE_ROOT}/100 percent/B.md`;
    await storage.write(`${folder}/A.md`, 'a');
    const seeded = await seedNeighbour(neighbour, ALICE, BOB);

    await trashRestoreTrashPurge(folder, ALICE);
    await assertUntouched(neighbour, seeded, 'after trash/restore/purge');
  });
});

describe('Trash — a corrupted row never aims a delete at live content', () => {
  it('refuses purge, retention, listing cleanup and restore when trashPath was tampered with', async () => {
    await storage.write('Projects/Live.md', 'live');
    const { code } = await shareLinks.mintExplicit({ path: 'Projects/Live.md', createdByEmail: ALICE });
    await storage.write('Old.md', 'old');
    const id = (await files.deleteFile('Old.md', undefined, ALICE)).trashItemId!;
    // Point the row at a live folder, as a bad migration or manual edit might.
    await trashRepo.update({ id }, { trashPath: 'Projects' });

    await assert.rejects(trash.purge(id, ALICE));
    assert.equal(await trash.purgeOlderThan(Date.now() + 1000), 0);
    await assert.rejects(trash.emptyTrash(ALICE));
    assert.deepEqual((await trash.list(ALICE)).map((i) => i.id), []);
    await assert.rejects(trash.restore(id, { email: ALICE }));

    assert.equal(await storage.read('Projects/Live.md'), 'live');
    assert.deepEqual(await shareLinks.resolve(code), { kind: 'ok', path: 'Projects/Live.md' });
    assert.ok(await trashRepo.findOneBy({ id }), 'the row is kept for an operator to inspect');
  });
});

describe('Trash — restore', () => {
  it('recreates missing parent folders', async () => {
    await storage.write('Deep/Er/Note.md', 'n');
    const id = (await files.deleteFile('Deep/Er/Note.md', undefined, ALICE)).trashItemId!;
    await storage.delete('Deep');
    const result = await trash.restore(id, { email: ALICE });
    assert.deepEqual(result, { id, path: 'Deep/Er/Note.md', kind: 'file' });
    assert.equal(await storage.read('Deep/Er/Note.md'), 'n');
    assert.equal(await trashRepo.count(), 0);
    assert.equal(await storage.exists(`.trash/${id}`), false);
  });

  it('appends " (restored)", then " (restored 2)" when the path is taken', async () => {
    await storage.write('Plan.md', 'first');
    const first = (await files.deleteFile('Plan.md', undefined, ALICE)).trashItemId!;
    await storage.write('Plan.md', 'second');
    const second = (await files.deleteFile('Plan.md', undefined, ALICE)).trashItemId!;
    await storage.write('Plan.md', 'current');

    assert.equal((await trash.restore(first, { email: ALICE })).path, 'Plan (restored).md');
    assert.equal((await trash.restore(second, { email: ALICE })).path, 'Plan (restored 2).md');
    assert.equal(await storage.read('Plan.md'), 'current');
    assert.equal(await storage.read('Plan (restored).md'), 'first');
    assert.equal(await storage.read('Plan (restored 2).md'), 'second');
  });

  it('restores a folder next to a folder that took its name', async () => {
    await storage.write('Drafts/a.md', 'a');
    const id = (await files.deleteDirectory('Drafts', ALICE)).trashItemId!;
    await storage.write('Drafts/new.md', 'n');
    const result = await trash.restore(id, { email: ALICE });
    assert.equal(result.path, 'Drafts (restored)');
    assert.equal(await storage.read('Drafts (restored)/a.md'), 'a');
  });

  it('records a created change with the content so history continues', async () => {
    await files.createFile('Hist.md', 'v1', 3, undefined, ALICE);
    await settle();
    const id = (await files.deleteFile('Hist.md', 3, ALICE)).trashItemId!;
    await trash.restore(id, { userId: 4, email: ALICE });
    await settle();
    assert.deepEqual(await changesFor('Hist.md'), ['created', 'deleted', 'created']);
    const last = await changeRepo.findOneOrFail({ where: { path: 'Hist.md' }, order: { id: 'DESC' } });
    assert.equal(last.userId, 4);
    assert.match(last.diff ?? '', /\+v1/);
  });

  it('feeds the restored note to in-process indexers and open sessions', async () => {
    await storage.write('Idx.md', 'indexed body');
    const id = (await files.deleteFile('Idx.md', undefined, ALICE)).trashItemId!;
    const indexed: string[] = [];
    const written: string[] = [];
    watcher.onInternalWrite((p, content) => { indexed.push(`${p}:${content}`); });
    files.on('file:written', (e: { path: string }) => written.push(e.path));
    await trash.restore(id, { email: ALICE });
    assert.deepEqual(indexed, ['Idx.md:indexed body']);
    assert.deepEqual(written, ['Idx.md']);
    assert.equal(watcher.isSelfRemoved('Idx.md'), true);
  });

  it('drops an item whose trash folder vanished and answers 404', async () => {
    await storage.write('Vanish.md', 'v');
    const id = (await files.deleteFile('Vanish.md', undefined, ALICE)).trashItemId!;
    await storage.delete('.trash');
    await assert.rejects(trash.restore(id, { email: ALICE }), NotFoundException);
    assert.equal(await trashRepo.count(), 0);
  });
});

describe('Trash — permissions', () => {
  it('never shows, restores or purges another user personal item', async () => {
    await storage.write(`${ALICE_ROOT}/Private.md`, 'p');
    const id = (await files.deleteFile(`${ALICE_ROOT}/Private.md`, undefined, ALICE)).trashItemId!;

    assert.deepEqual((await trash.list(BOB)).map((i) => i.id), []);
    assert.deepEqual((await trash.list(ALICE)).map((i) => i.id), [id]);
    await assert.rejects(trash.restore(id, { email: BOB }), NotFoundException);
    await assert.rejects(trash.purge(id, BOB), NotFoundException);
    // Admins cannot reach into a personal trash either.
    await assert.rejects(trash.purge(id, ADMIN), NotFoundException);
    assert.equal(await trash.emptyTrash(BOB), 0);
    assert.equal(await storage.exists(`${ALICE_ROOT}/.trash/${id}/Private.md`), true);
  });

  it('lists shared items for everyone, with canPurge for the deleter only', async () => {
    await storage.write('Team.md', 't');
    const id = (await files.deleteFile('Team.md', undefined, ALICE)).trashItemId!;
    const [forBob] = await trash.list(BOB);
    assert.equal(forBob.id, id);
    assert.equal(forBob.name, 'Team.md');
    assert.equal(forBob.originalFolder, '');
    assert.equal(forBob.deletedByEmail, ALICE);
    assert.equal(forBob.canPurge, false);
    assert.equal((await trash.list(ALICE))[0].canPurge, true);
    assert.equal((await trash.list(ADMIN))[0].canPurge, true);
  });

  it('lets any user restore a shared item but only the deleter or an admin purge it', async () => {
    await storage.write('Team.md', 't');
    const a = (await files.deleteFile('Team.md', undefined, ALICE)).trashItemId!;
    await assert.rejects(trash.purge(a, BOB), ForbiddenException);
    assert.equal((await trash.restore(a, { email: BOB })).path, 'Team.md');

    const b = (await files.deleteFile('Team.md', undefined, ALICE)).trashItemId!;
    await trash.purge(b, ADMIN);
    assert.equal(await storage.exists(`.trash/${b}`), false);
  });

  it('lets the personal owner purge an item a write-grantee deleted', async () => {
    const note = `${ALICE_ROOT}/Collab.md`;
    await storage.write(note, 'c');
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: note, permission: 'write' });
    const id = (await files.deleteFile(note, undefined, BOB)).trashItemId!;
    const [item] = await trash.list(ALICE);
    assert.equal(item.deletedByEmail, BOB);
    assert.equal(item.canPurge, true);
    // The grantee cannot see the owner's trash.
    await assert.rejects(trash.restore(id, { email: BOB }), NotFoundException);
    await trash.purge(id, ALICE);
    assert.equal(await trashRepo.count(), 0);
  });

  it('empty trash purges only what the caller may purge', async () => {
    await storage.write('Mine.md', 'm');
    await storage.write('Theirs.md', 't');
    await storage.write(`${ALICE_ROOT}/Personal.md`, 'p');
    await files.deleteFile('Mine.md', undefined, ALICE);
    const theirs = (await files.deleteFile('Theirs.md', undefined, BOB)).trashItemId!;
    await files.deleteFile(`${ALICE_ROOT}/Personal.md`, undefined, ALICE);

    assert.equal(await trash.emptyTrash(ALICE), 2);
    assert.deepEqual((await trash.list(ALICE)).map((i) => i.id), [theirs]);
  });
});

describe('Trash — purge', () => {
  it('removes the files and the dormant rows; the handle stays tombstoned', async () => {
    const note = `${ALICE_ROOT}/Purge.md`;
    await files.createFile(note, 'bye', undefined, undefined, ALICE);
    await settle();
    const handle = await docHandles.findOrCreateForPath(note);
    const { code } = await shareLinks.mintExplicit({ path: note, createdByEmail: ALICE });
    const grant = await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path: note, permission: 'read' });
    await stars.addStar(1, 'file', note);
    await pins.setPin(note, 'correct-horse', ALICE);
    const id = (await files.deleteFile(note, undefined, ALICE)).trashItemId!;
    const trashPath = `${ALICE_ROOT}/.trash/${id}/Purge.md`;

    await trash.purge(id, ALICE);
    assert.equal(await storage.exists(`${ALICE_ROOT}/.trash/${id}`), false);
    assert.equal(await trashRepo.count(), 0);
    assert.equal(await shareLinks.findByPath(trashPath), null);
    assert.deepEqual(await shareLinks.resolve(code), { kind: 'not_found' });
    assert.notEqual((await grants.findById(grant.id))!.revokedAt, null);
    assert.equal(await starRepo.count(), 0);
    assert.equal(await pins.hasPin(trashPath), false);
    assert.equal((await docHandles.resolve(handle)).tombstoned, true);
  });

  it('purges items past the retention cutoff only', async () => {
    await storage.write('Old.md', 'o');
    await storage.write('New.md', 'n');
    const oldId = (await files.deleteFile('Old.md', undefined, ALICE)).trashItemId!;
    const newId = (await files.deleteFile('New.md', undefined, ALICE)).trashItemId!;
    await trashRepo.update({ id: oldId }, { deletedAt: Date.now() - 31 * 86_400_000 });

    assert.equal(await trash.purgeOlderThan(Date.now() - 30 * 86_400_000), 1);
    assert.deepEqual((await trash.list(ALICE)).map((i) => i.id), [newId]);
    assert.equal(await storage.exists(`.trash/${oldId}`), false);
  });
});

describe('Trash — retention setting', () => {
  it('defaults to 30, accepts 0, and falls back on garbage', () => {
    const prev = process.env.TRASH_RETENTION_DAYS;
    try {
      delete process.env.TRASH_RETENTION_DAYS;
      assert.equal(trashRetentionDays(), 30);
      process.env.TRASH_RETENTION_DAYS = '0';
      assert.equal(trashRetentionDays(), 0);
      process.env.TRASH_RETENTION_DAYS = '7';
      assert.equal(trashRetentionDays(), 7);
      process.env.TRASH_RETENTION_DAYS = '-3';
      assert.equal(trashRetentionDays(), 30);
      process.env.TRASH_RETENTION_DAYS = 'soon';
      assert.equal(trashRetentionDays(), 30);
    } finally {
      if (prev === undefined) delete process.env.TRASH_RETENTION_DAYS;
      else process.env.TRASH_RETENTION_DAYS = prev;
    }
  });
});

describe('Trash — path helpers', () => {
  it('builds restore names before the extension', () => {
    assert.equal(restoredName('Plan.md', 'file', 1), 'Plan (restored).md');
    assert.equal(restoredName('a/b/Plan.md', 'file', 3), 'a/b/Plan (restored 3).md');
    assert.equal(restoredName('a/Drafts', 'folder', 1), 'a/Drafts (restored)');
    assert.equal(restoredName('v1.2 notes', 'folder', 2), 'v1.2 notes (restored 2)');
  });

  it('places personal items in the owner trash', () => {
    assert.equal(trashPathFor(`${ALICE_ROOT}/x/y.md`, 'abc'), `${ALICE_ROOT}/.trash/abc/y.md`);
    assert.equal(trashPathFor('x/y.md', 'abc'), '.trash/abc/y.md');
  });
});
