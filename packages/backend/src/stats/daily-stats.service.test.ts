import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { DailyStats } from '../entities/daily-stats.entity';
import { FailedSearch } from '../entities/failed-search.entity';
import { DailyStatsService } from './daily-stats.service';

let ds: DataSource;
let dailyStatsRepo: Repository<DailyStats>;
let failedSearchRepo: Repository<FailedSearch>;
let service: DailyStatsService;

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [DailyStats, FailedSearch],
    synchronize: true,
  });
  await ds.initialize();
  dailyStatsRepo = ds.getRepository(DailyStats);
  failedSearchRepo = ds.getRepository(FailedSearch);
  service = new DailyStatsService(dailyStatsRepo, failedSearchRepo);
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

describe('DailyStatsService', () => {
  beforeEach(setup);
  afterEach(teardown);

  describe('counter accumulation', () => {
    it('accumulates search counters', async () => {
      service.trackSearch(false);
      service.trackSearch(true);
      service.trackSearch(false);

      await service.flush();
      const rows = await dailyStatsRepo.find();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].searches, 3);
      assert.equal(rows[0].searches_empty, 1);
    });

    it('accumulates note counters', async () => {
      service.trackNoteCreated();
      service.trackNoteCreated();
      service.trackNoteEdited();

      await service.flush();
      const rows = await dailyStatsRepo.find();
      assert.equal(rows[0].notes_created, 2);
      assert.equal(rows[0].notes_edited, 1);
    });

    it('accumulates comment counters', async () => {
      service.trackCommentAdded();
      service.trackCommentAdded();
      service.trackCommentResolved();

      await service.flush();
      const rows = await dailyStatsRepo.find();
      assert.equal(rows[0].comments_added, 2);
      assert.equal(rows[0].comments_resolved, 1);
    });

    it('accumulates OT concurrent edits', async () => {
      service.trackOtConcurrentEdit();
      service.trackOtConcurrentEdit();

      await service.flush();
      const rows = await dailyStatsRepo.find();
      assert.equal(rows[0].ot_concurrent_edits, 2);
    });

    it('tracks unique active users', async () => {
      service.trackActiveUser(1);
      service.trackActiveUser(2);
      service.trackActiveUser(1); // duplicate

      await service.flush();
      const rows = await dailyStatsRepo.find();
      assert.equal(rows[0].active_users, 2);
    });
  });

  describe('flush', () => {
    it('does not create a row when no events tracked', async () => {
      await service.flush();
      const rows = await dailyStatsRepo.find();
      assert.equal(rows.length, 0);
    });

    it('merges with existing row on second flush', async () => {
      service.trackSearch(false);
      await service.flush();

      service.trackSearch(true);
      await service.flush();

      const rows = await dailyStatsRepo.find();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].searches, 2);
      assert.equal(rows[0].searches_empty, 1);
    });

    it('resets counters after flush', async () => {
      service.trackNoteCreated();
      await service.flush();
      await service.flush(); // second flush with no new events

      const rows = await dailyStatsRepo.find();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].notes_created, 1);
    });
  });

  describe('pruning', () => {
    it('deletes rows older than 90 days', async () => {
      await ds.query(
        `INSERT INTO daily_stats (date, active_users, searches, searches_empty, notes_created, notes_edited, comments_added, comments_resolved, ot_concurrent_edits)
         VALUES (date('now', '-91 days'), 1, 5, 0, 0, 0, 0, 0, 0)`,
      );
      service.trackSearch(false);
      await service.flush();

      assert.equal((await dailyStatsRepo.find()).length, 2);
      await service.pruneOldDailyStats();
      const remaining = await dailyStatsRepo.find();
      assert.equal(remaining.length, 1);
    });
  });
});

describe('DailyStatsService - failed searches', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('logs a failed search', async () => {
    await service.logFailedSearch('quantum entanglement', 'frontend');
    const rows = await failedSearchRepo.find();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].query, 'quantum entanglement');
    assert.equal(rows[0].source, 'frontend');
  });

  it('enforces FIFO eviction at 100-row cap', async () => {
    // Insert 100 rows
    for (let i = 0; i < 100; i++) {
      await service.logFailedSearch(`query_${i}`, 'frontend');
    }
    assert.equal(await failedSearchRepo.count(), 100);

    // Insert one more — should evict the oldest
    await service.logFailedSearch('newest_query', 'mcp');
    assert.equal(await failedSearchRepo.count(), 100);

    // The oldest (query_0) should be gone
    const rows = await failedSearchRepo.find({ order: { timestamp: 'ASC' } });
    assert.equal(rows[0].query, 'query_1');
    assert.equal(rows[rows.length - 1].query, 'newest_query');
  });

  it('does not evict when under capacity', async () => {
    await service.logFailedSearch('q1', 'frontend');
    await service.logFailedSearch('q2', 'mcp');
    assert.equal(await failedSearchRepo.count(), 2);
  });
});
