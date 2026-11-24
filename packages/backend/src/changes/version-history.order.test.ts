import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { NoteChange } from '../entities';
import { VersionHistoryService } from './version-history.service';

describe('VersionHistoryService — getHistory order', () => {
  it('lists changes made within the same second newest first', async () => {
    const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [NoteChange], synchronize: true });
    await ds.initialize();
    try {
      const repo = ds.getRepository(NoteChange);
      // A restore writes a snapshot row and the restore itself within one second.
      for (const action of ['created', 'modified', 'modified', 'modified'] as const) {
        await repo.save(repo.create({ path: 'plan.md', action, diff: null, userId: null }));
      }
      await ds.query(`UPDATE note_changes SET createdAt = '2026-11-24 10:00:00'`);
      const svc = new VersionHistoryService(repo, {} as any, {} as any);
      assert.deepEqual((await svc.getHistory('plan.md')).map((h) => h.id), [4, 3, 2, 1]);
    } finally {
      await ds.destroy();
    }
  });
});
