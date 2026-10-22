import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { FilesService } from './files.service';

// A path that starts with the caller's personal root but climbs out with
// `..` must not be treated as owned: storage would resolve it into another
// user's folder (or the whole personal root).

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const BOB_NOTE = '_users/bob@example.com/secret.md';
const VIA_ALICE = '_users/alice@example.com/../bob@example.com/secret.md';

let tmpRoot: string;
let personalRoot: string;
let service: FilesService;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-traversal-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  const sharedRoot = path.join(tmpRoot, 'vault');
  personalRoot = path.join(tmpRoot, 'personal');
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  const routing = new RoutingStorageAdapter(new LocalFSAdapter(sharedRoot), new LocalFSAdapter(personalRoot));
  await routing.ensurePersonalFolder(ALICE);
  await routing.ensurePersonalFolder(BOB);
  service = new FilesService(routing as any);
  await service.createFile(BOB_NOTE, 'bob only', undefined, undefined, BOB);
});

async function bobNoteIntact(): Promise<void> {
  assert.equal(await service.readFile(BOB_NOTE, BOB), 'bob only');
}

describe('FilesService — `..` in personal paths', () => {
  it('read, write, delete and move refuse a path that climbs into another user', async () => {
    await assert.rejects(service.readFile(VIA_ALICE, ALICE), NotFoundException);
    await assert.rejects(service.createFile(VIA_ALICE, 'pwned', undefined, undefined, ALICE), NotFoundException);
    await assert.rejects(service.deleteFile(VIA_ALICE, undefined, ALICE), NotFoundException);
    await service.createFile('_users/alice@example.com/a.md', 'a', undefined, undefined, ALICE);
    await assert.rejects(
      service.move('_users/alice@example.com/a.md', '_users/alice@example.com/../bob@example.com/a.md', ALICE),
      NotFoundException,
    );
    await bobNoteIntact();
  });

  it('directory delete cannot reach another user folder or the personal root', async () => {
    await assert.rejects(
      service.deleteDirectory('_users/alice@example.com/../bob@example.com', ALICE),
      NotFoundException,
    );
    await assert.rejects(service.deleteDirectory('_users/alice@example.com/..', ALICE), NotFoundException);
    await bobNoteIntact();
  });

  it('listing refuses to climb out of the caller root', async () => {
    await assert.rejects(service.listTree('_users/alice@example.com/..', ALICE), NotFoundException);
  });
});
