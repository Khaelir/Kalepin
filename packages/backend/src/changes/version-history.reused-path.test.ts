import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NoteChange, NoteSnapshot, User } from '../entities';
import { ChangeTrackingService } from './change-tracking.service';
import { VersionHistoryService } from './version-history.service';

// History is keyed by path. Alice trashes her private Notes.md, later creates
// a new note at the same path and grants Bob read: Bob must not be able to
// list or rebuild the earlier note from its history.

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const NOTE = `_users/${ALICE}/Notes.md`;

let ds: DataSource;
let tracking: ChangeTrackingService;
let history: VersionHistoryService;

beforeEach(async () => {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [NoteChange, NoteSnapshot, User],
    synchronize: true,
  });
  await ds.initialize();
  const repos = [ds.getRepository(NoteChange), ds.getRepository(NoteSnapshot), ds.getRepository(User)] as const;
  tracking = new ChangeTrackingService(...repos);
  history = new VersionHistoryService(...repos);
});

afterEach(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

async function lastId(): Promise<number> {
  const [row] = await ds.getRepository(NoteChange).find({ order: { id: 'DESC' }, take: 1 });
  return row.id;
}

describe('VersionHistoryService — a reused path', () => {
  it('shows a grantee only the note now at the path; the owner sees everything', async () => {
    await tracking.trackChange(NOTE, 'created', null, 'old private v1', 1);
    await tracking.trackChange(NOTE, 'modified', 'old private v1', 'old private v2', 1);
    const oldVersion = await lastId();
    await tracking.trackChange(NOTE, 'deleted', null, null, 1);
    await tracking.trackChange(NOTE, 'created', null, 'new note', 1);
    const created = await lastId();
    await tracking.trackChange(NOTE, 'modified', 'new note', 'new note, edited', 1);
    const latest = await lastId();

    assert.deepEqual((await history.getHistory(NOTE, BOB)).map((h) => h.id), [latest, created]);
    await assert.rejects(history.reconstructVersion(NOTE, oldVersion, BOB), NotFoundException);
    assert.equal((await history.reconstructVersion(NOTE, latest, BOB)).content, 'new note, edited');

    assert.equal((await history.getHistory(NOTE, ALICE)).length, 5);
    assert.equal((await history.reconstructVersion(NOTE, oldVersion, ALICE)).content, 'old private v2');
  });

  it('also when the earlier note was moved away rather than deleted', async () => {
    // FilesService.move leaves history rows at the old path, with no `deleted` row.
    await tracking.trackChange(NOTE, 'created', null, 'moved-away note', 1);
    const oldVersion = await lastId();
    await tracking.trackChange(NOTE, 'created', null, 'new note', 1);
    const created = await lastId();

    assert.deepEqual((await history.getHistory(NOTE, BOB)).map((h) => h.id), [created]);
    await assert.rejects(history.reconstructVersion(NOTE, oldVersion, BOB), NotFoundException);
  });

  it('starts after a deletion when the new note has no `created` row (written outside Kalepin)', async () => {
    await tracking.trackChange(NOTE, 'created', null, 'old private', 1);
    await tracking.trackChange(NOTE, 'deleted', null, null, 1);
    assert.deepEqual(await history.getHistory(NOTE, BOB), []);
  });

  it('leaves shared-vault history alone', async () => {
    await tracking.trackChange('Plan.md', 'created', null, 'v1', 1);
    await tracking.trackChange('Plan.md', 'deleted', null, null, 1);
    await tracking.trackChange('Plan.md', 'created', null, 'v2', 1);
    assert.equal((await history.getHistory('Plan.md', BOB)).length, 3);
  });
});
