import 'reflect-metadata';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { McpUsageLog } from '../entities/mcp-usage-log.entity';
import { DailyStats } from '../entities/daily-stats.entity';
import { FailedSearch } from '../entities/failed-search.entity';
import { StatsService } from './stats.service';
import { DailyStatsService } from './daily-stats.service';

let ds: DataSource;
let repo: Repository<McpUsageLog>;
let service: StatsService;
let dailyStatsService: DailyStatsService;

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [McpUsageLog, DailyStats, FailedSearch],
    synchronize: true,
  });
  await ds.initialize();
  // Create a minimal users table for the join in getUsers()
  await ds.query(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)`);
  repo = ds.getRepository(McpUsageLog);
  dailyStatsService = new DailyStatsService(ds.getRepository(DailyStats), ds.getRepository(FailedSearch));
  const sidecarService = { getThreadsForDocument: async () => [] } as any;
  service = new StatsService(repo, ds, dailyStatsService, sidecarService);
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

async function insertLog(overrides: Partial<McpUsageLog> = {}) {
  const entry = repo.create({
    toolName: 'search_notes',
    userId: 1,
    apiKeyId: null,
    durationMs: 50,
    success: true,
    error: null,
    ...overrides,
  });
  return repo.save(entry);
}

describe('StatsService', () => {
  beforeEach(setup);
  afterEach(teardown);

  describe('logToolCall', () => {
    it('inserts a successful call', async () => {
      await service.logToolCall('search_notes', 1, 10, 42, true);
      const rows = await repo.find();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].toolName, 'search_notes');
      assert.equal(rows[0].userId, 1);
      assert.equal(rows[0].apiKeyId, 10);
      assert.equal(rows[0].durationMs, 42);
      assert.equal(rows[0].success, true);
      assert.equal(rows[0].error, null);
    });

    it('inserts a failed call with error message', async () => {
      await service.logToolCall('read_note', 2, null, 100, false, 'File not found');
      const rows = await repo.find();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].success, false);
      assert.equal(rows[0].error, 'File not found');
      assert.equal(rows[0].apiKeyId, null);
    });
  });

  describe('pruneOldEntries', () => {
    it('deletes entries older than 14 days', async () => {
      await ds.query(
        `INSERT INTO mcp_usage_log (toolName, userId, durationMs, success, timestamp)
         VALUES ('old_tool', 1, 10, 1, datetime('now', '-15 days'))`,
      );
      await insertLog();

      assert.equal((await repo.find()).length, 2);
      await service.pruneOldEntries();
      const remaining = await repo.find();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].toolName, 'search_notes');
    });

    it('keeps entries within 14 days', async () => {
      await insertLog();
      await service.pruneOldEntries();
      assert.equal((await repo.find()).length, 1);
    });

    it('is idempotent', async () => {
      await service.pruneOldEntries();
      await service.pruneOldEntries();
      assert.equal((await repo.find()).length, 0);
    });

    it('enforces 5000-row hard cap after time-based prune', async () => {
      // Insert 5005 recent rows
      const values = Array.from({ length: 5005 }, (_, i) =>
        `('tool_${i}', 1, 10, 1, datetime('now', '-${i} minutes'))`,
      ).join(',');
      await ds.query(
        `INSERT INTO mcp_usage_log (toolName, userId, durationMs, success, timestamp) VALUES ${values}`,
      );
      assert.equal((await repo.find()).length, 5005);

      await service.pruneOldEntries();
      assert.equal((await repo.find()).length, 5000);
    });

    it('does not delete when under hard cap', async () => {
      await insertLog();
      await insertLog({ toolName: 'read_note' });
      await service.pruneOldEntries();
      assert.equal((await repo.find()).length, 2);
    });
  });

  describe('getOverview', () => {
    it('returns daily aggregates', async () => {
      await insertLog({ durationMs: 100, success: true });
      await insertLog({ durationMs: 200, success: false, error: 'fail' });

      const result = await service.getOverview();
      assert.equal(result.days.length, 1);
      assert.equal(result.days[0].totalCalls, 2);
      assert.equal(result.days[0].errors, 1);
      assert.equal(result.days[0].avgDurationMs, 150);
    });

    it('returns empty array when no data', async () => {
      const result = await service.getOverview();
      assert.deepEqual(result, { days: [] });
    });
  });

  describe('getMcpTools', () => {
    it('returns per-tool aggregates ordered by call count', async () => {
      await insertLog({ toolName: 'search_notes', durationMs: 100 });
      await insertLog({ toolName: 'search_notes', durationMs: 200 });
      await insertLog({ toolName: 'read_note', durationMs: 50 });

      const result = await service.getMcpTools();
      assert.equal(result.tools.length, 2);
      assert.equal(result.tools[0].toolName, 'search_notes');
      assert.equal(result.tools[0].totalCalls, 2);
      assert.equal(result.tools[0].avgDurationMs, 150);
      assert.equal(result.tools[0].maxDurationMs, 200);
      assert.equal(result.tools[1].toolName, 'read_note');
      assert.equal(result.tools[1].totalCalls, 1);
    });

    it('includes P50/P95 percentiles', async () => {
      // Insert 10 entries with increasing durations
      for (let i = 1; i <= 10; i++) {
        await insertLog({ toolName: 'search_notes', durationMs: i * 10 });
      }

      const result = await service.getMcpTools();
      const tool = result.tools[0];
      assert.equal(tool.toolName, 'search_notes');
      assert.ok(typeof tool.p50Ms === 'number');
      assert.ok(typeof tool.p95Ms === 'number');
      assert.ok(tool.p50Ms <= tool.p95Ms, 'P50 should be <= P95');
    });

    it('returns avgResultCount for search tools and null for others', async () => {
      await insertLog({ toolName: 'search_notes', durationMs: 50, resultCount: 5 });
      await insertLog({ toolName: 'search_notes', durationMs: 60, resultCount: 15 });
      await insertLog({ toolName: 'read_note', durationMs: 30 });

      const result = await service.getMcpTools();
      const searchTool = result.tools.find((t) => t.toolName === 'search_notes')!;
      const readTool = result.tools.find((t) => t.toolName === 'read_note')!;
      assert.equal(searchTool.avgResultCount, 10);
      assert.equal(readTool.avgResultCount, null);
    });
  });

  describe('getUsers', () => {
    it('returns per-user aggregates with top tools', async () => {
      await ds.query(`INSERT INTO users (id, email) VALUES (1, 'alice@test.com')`);
      await ds.query(`INSERT INTO users (id, email) VALUES (2, 'bob@test.com')`);

      await insertLog({ userId: 1, toolName: 'search_notes' });
      await insertLog({ userId: 1, toolName: 'search_notes' });
      await insertLog({ userId: 1, toolName: 'read_note' });
      await insertLog({ userId: 2, toolName: 'edit_note' });

      const result = await service.getUsers();
      assert.equal(result.users.length, 2);
      assert.equal(result.users[0].userId, 1);
      assert.equal(result.users[0].email, 'alice@test.com');
      assert.equal(result.users[0].totalCalls, 3);
      assert.equal(result.users[0].topTools[0], 'search_notes');
      assert.equal(result.users[1].userId, 2);
      assert.equal(result.users[1].totalCalls, 1);
    });

    it('returns empty array when no data', async () => {
      const result = await service.getUsers();
      assert.deepEqual(result, { users: [] });
    });
  });

  describe('getSystemHealth', () => {
    const mockRuntime = {
      uptimeSeconds: 3600,
      embeddingModel: { ready: true, modelName: 'multilingual-e5-base' },
      vectorCache: { loaded: true, chunkCount: 100, estimatedSizeBytes: 307200 },
      otSessions: [],
    };

    it('returns correct shape', async () => {
      const result = await service.getSystemHealth(mockRuntime);
      assert.ok(result.db);
      assert.ok(result.vault);
      assert.ok(result.runtime);
      const db = result.db as any;
      assert.ok(typeof db.fileSizeBytes === 'number');
      assert.ok(typeof db.tables === 'object');
      assert.ok(typeof db.embeddingCoverage === 'object');
      assert.ok(typeof db.ftsCoverage === 'object');
    });

    it('includes runtime stats as passed', async () => {
      const result = await service.getSystemHealth(mockRuntime);
      assert.deepEqual(result.runtime, mockRuntime);
    });

    it('returns table row counts', async () => {
      await insertLog();
      const result = await service.getSystemHealth(mockRuntime);
      const db = result.db as any;
      assert.equal(db.tables.mcp_usage_log, 1);
    });
  });

  describe('getAppStats', () => {
    it('returns days and failedSearches', async () => {
      const result = await service.getAppStats();
      assert.ok(Array.isArray(result.days));
      assert.ok(Array.isArray(result.failedSearches));
    });
  });
});
