import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from './files.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

let tmpRoot: string;
let sharedRoot: string;
let personalRoot: string;
let routing: RoutingStorageAdapter;
let service: FilesService;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-files-personal-'));
  sharedRoot = path.join(tmpRoot, 'vault');
  personalRoot = path.join(tmpRoot, 'personal');
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  routing = new RoutingStorageAdapter(
    new LocalFSAdapter(sharedRoot),
    new LocalFSAdapter(personalRoot),
  );
  service = new FilesService(routing as any);
  // Provision Alice's personal folder
  await routing.ensurePersonalFolder(ALICE);
});

describe('FilesService — owner-OK paths', () => {
  it('owner can create + read in their own personal folder', async () => {
    await service.createFile('_users/alice@example.com/diary.md', 'private', undefined, undefined, ALICE);
    const body = await service.readFile('_users/alice@example.com/diary.md', ALICE);
    assert.equal(body, 'private');
  });

  it('shared paths are readable by both users', async () => {
    await service.createFile('Notes/foo.md', 'shared', undefined, undefined, ALICE);
    assert.equal(await service.readFile('Notes/foo.md', ALICE), 'shared');
    assert.equal(await service.readFile('Notes/foo.md', BOB), 'shared');
  });
});

describe('FilesService — cross-personal returns 404', () => {
  it('Bob reading Alice\'s personal note returns 404', async () => {
    await service.createFile('_users/alice@example.com/diary.md', 'private', undefined, undefined, ALICE);
    await assert.rejects(
      () => service.readFile('_users/alice@example.com/diary.md', BOB),
      (err: any) => err instanceof NotFoundException,
    );
  });

  it('Bob writing into Alice\'s personal folder returns 404 (assertWritableBy)', async () => {
    await assert.rejects(
      () => service.createFile('_users/alice@example.com/intruder.md', 'x', undefined, undefined, BOB),
      (err: any) => err instanceof NotFoundException,
    );
  });

  it('Bob deleting Alice\'s personal note returns 404', async () => {
    await service.createFile('_users/alice@example.com/diary.md', 'x', undefined, undefined, ALICE);
    await assert.rejects(
      () => service.deleteFile('_users/alice@example.com/diary.md', undefined, BOB),
      (err: any) => err instanceof NotFoundException,
    );
  });
});

describe('FilesService — root-segment immutable', () => {
  it('owner cannot rename their personal-folder root segment (400)', async () => {
    await assert.rejects(
      () => service.move('_users/alice@example.com', '_users/different@example.com', ALICE),
      (err: any) => err instanceof BadRequestException || err instanceof NotFoundException,
    );
  });

  it('owner cannot delete their personal-folder root (400)', async () => {
    await assert.rejects(
      () => service.deleteDirectory('_users/alice@example.com', ALICE),
      (err: any) => err instanceof BadRequestException,
    );
  });
});

describe('FilesService — move boundary semantics', () => {
  it('shared → owner-personal (promote) is allowed', async () => {
    await service.createFile('Notes/foo.md', 'promoted', undefined, undefined, ALICE);
    await service.move('Notes/foo.md', '_users/alice@example.com/foo.md', ALICE);
    assert.equal(await service.readFile('_users/alice@example.com/foo.md', ALICE), 'promoted');
  });

  it('owner-personal → shared (demote) is allowed', async () => {
    await service.createFile('_users/alice@example.com/foo.md', 'demoted', undefined, undefined, ALICE);
    await service.move('_users/alice@example.com/foo.md', 'Notes/foo.md', ALICE);
    assert.equal(await service.readFile('Notes/foo.md', ALICE), 'demoted');
  });

  it('moving INTO another user\'s root rejects 404 (existence non-observable)', async () => {
    await service.createFile('Notes/foo.md', 'x', undefined, undefined, ALICE);
    await assert.rejects(
      () => service.move('Notes/foo.md', '_users/bob@example.com/foo.md', ALICE),
      (err: any) => err instanceof NotFoundException,
    );
  });

  it('moving dest = "_users" exact returns 400 (reservation, no user existence leak)', async () => {
    await service.createFile('Notes/foo.md', 'x', undefined, undefined, ALICE);
    // The bare "_users" string does not match any user's root segment, so it's a
    // reservation-violation 400. It does not reveal the existence of any specific user.
    await assert.rejects(
      () => service.move('Notes/foo.md', '_users', ALICE),
      (err: any) => err instanceof BadRequestException,
    );
  });
});

describe('FilesService — listTree filters by viewer', () => {
  it('Bob never sees Alice\'s personal subtree at root', async () => {
    await service.createFile('_users/alice@example.com/diary.md', 'private', undefined, undefined, ALICE);
    await service.createFile('Notes/shared.md', 'shared', undefined, undefined, ALICE);

    const aliceTree = await service.listTree('', ALICE);
    const bobTree = await service.listTree('', BOB);

    const flat = (es: any[]): string[] => es.flatMap((e) => [e.path, ...(e.children ? flat(e.children) : [])]);
    const aliceAll = flat(aliceTree);
    const bobAll = flat(bobTree);

    assert.ok(aliceAll.includes('_users/alice@example.com/diary.md'), 'Alice sees her diary');
    assert.ok(!bobAll.some((p) => p.includes('alice@example.com')), `Bob sees: ${bobAll.join(', ')}`);
    assert.ok(bobAll.includes('Notes/shared.md'), 'Bob sees shared notes');
  });

  it('listing _users returns []', async () => {
    await service.createFile('_users/alice@example.com/diary.md', 'private', undefined, undefined, ALICE);
    const entries = await service.listTree('_users', BOB);
    assert.deepEqual(entries, []);
  });

  it('Bob listing Alice\'s subtree directly returns 404', async () => {
    await service.createFile('_users/alice@example.com/diary.md', 'private', undefined, undefined, ALICE);
    await assert.rejects(
      () => service.listTree('_users/alice@example.com', BOB),
      (err: any) => err instanceof NotFoundException,
    );
  });
});

describe('FilesService — system caller (no userEmail) preserves legacy behavior', () => {
  it('omitting userEmail does not gate (used by internal callers, MCP pre-Phase-13)', async () => {
    await service.createFile('_users/alice@example.com/diary.md', 'x', undefined, undefined, ALICE);
    // No userEmail → no predicate. This MUST keep working until Phase 13.
    const body = await service.readFile('_users/alice@example.com/diary.md');
    assert.equal(body, 'x');
  });
});
