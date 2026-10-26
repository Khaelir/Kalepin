import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { PinLockedException } from '../pin/pin.service';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';

// History rows carry past note content, so /history, /version and /restore
// must apply the same visibility and PIN gates as /read and /create.

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ALICE_NOTE = '_users/alice@example.com/Journal.md';
const LOCKED_NOTE = 'Notes/locked.md';

let tmpRoot: string;
let controller: FilesController;
let historyCalls: string[];

const stubPin = {
  assertUnlockedForRequest: async (_req: unknown, p: string) => {
    if (p === LOCKED_NOTE) throw new PinLockedException(p);
  },
} as any;

const stubVersionHistory = {
  getHistory: async (p: string) => {
    historyCalls.push(`history:${p}`);
    return [];
  },
  reconstructVersion: async (p: string) => {
    historyCalls.push(`version:${p}`);
    return { content: 'old', partial: false };
  },
  createPreRestoreSnapshot: async (p: string) => {
    historyCalls.push(`snapshot:${p}`);
  },
} as any;

function req(email: string): any {
  return { headers: {}, user: { email, sub: 1 } };
}

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-history-access-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  historyCalls = [];
  const sharedRoot = path.join(tmpRoot, 'vault');
  const personalRoot = path.join(tmpRoot, 'personal');
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(personalRoot, { recursive: true, force: true });
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.mkdir(personalRoot, { recursive: true });
  const routing = new RoutingStorageAdapter(new LocalFSAdapter(sharedRoot), new LocalFSAdapter(personalRoot));
  const filesService = new FilesService(routing as any);
  controller = new FilesController(
    filesService,
    stubVersionHistory,
    {} as any,
    routing as any,
    stubPin,
    {} as any,
    { record: () => {} } as any,
    {} as any,
    {} as any,
  );
});

describe('FilesController history endpoints — access control', () => {
  it('hides another user\'s personal note history and versions', async () => {
    await assert.rejects(controller.getHistory(ALICE_NOTE, req(BOB)), NotFoundException);
    await assert.rejects(controller.getVersion(ALICE_NOTE, '2147483647', req(BOB)), NotFoundException);
    await assert.rejects(
      controller.restoreVersion({ path: ALICE_NOTE, changeId: 1 }, req(BOB)),
      NotFoundException,
    );
    assert.deepEqual(historyCalls, []);
  });

  it('rejects traversal spellings of another user\'s path', async () => {
    const traversal = '_users/bob@example.com/../alice@example.com/Journal.md';
    await assert.rejects(controller.getVersion(traversal, '1', req(BOB)), NotFoundException);
    assert.deepEqual(historyCalls, []);
  });

  it('applies the PIN gate', async () => {
    await assert.rejects(controller.getHistory(LOCKED_NOTE, req(ALICE)), PinLockedException);
    await assert.rejects(controller.getVersion(LOCKED_NOTE, '1', req(ALICE)), PinLockedException);
    await assert.rejects(
      controller.restoreVersion({ path: LOCKED_NOTE, changeId: 1 }, req(ALICE)),
      PinLockedException,
    );
    assert.deepEqual(historyCalls, []);
  });

  it('gates create on the .md path it writes, not the raw one', async () => {
    await assert.rejects(controller.createFile({ path: 'Notes/locked', content: 'x' }, req(ALICE)), PinLockedException);
    await assert.rejects(controller.createFile({ path: LOCKED_NOTE, content: 'x' }, req(ALICE)), PinLockedException);
  });

  it('serves the owner', async () => {
    assert.deepEqual(await controller.getHistory(ALICE_NOTE, req(ALICE)), []);
    assert.deepEqual(await controller.getVersion(ALICE_NOTE, '3', req(ALICE)), { content: 'old', partial: false });
    assert.deepEqual(historyCalls, [`history:${ALICE_NOTE}`, `version:${ALICE_NOTE}`]);
  });
});
