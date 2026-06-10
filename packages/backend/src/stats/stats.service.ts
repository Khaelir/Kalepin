import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { McpUsageLog } from '../entities/mcp-usage-log.entity';
import { SidecarService } from '../comments/sidecar.service';
import { DailyStatsService } from './daily-stats.service';

export interface RuntimeStats {
  uptimeSeconds: number;
  embeddingModel: { ready: boolean; modelName: string };
  vectorCache: { loaded: boolean; chunkCount: number; estimatedSizeBytes: number };
  otSessions: { docId: string; clientCount: number; revision: number }[];
}

@Injectable()
export class StatsService implements OnModuleInit {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @InjectRepository(McpUsageLog)
    private readonly usageRepo: Repository<McpUsageLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly dailyStatsService: DailyStatsService,
    private readonly sidecarService: SidecarService,
  ) {}

  async onModuleInit() {
    await this.pruneOldEntries();
  }

  async logToolCall(
    toolName: string,
    userId: number,
    apiKeyId: number | null,
    durationMs: number,
    success: boolean,
    error?: string,
    opts?: { resultCount?: number; errorMessage?: string; grantId?: number | null },
  ): Promise<void> {
    await this.usageRepo.insert({
      toolName,
      userId,
      apiKeyId: apiKeyId ?? null,
      grantId: opts?.grantId ?? null,
      durationMs,
      success,
      error: error ?? null,
      resultCount: opts?.resultCount ?? null,
      errorMessage: opts?.errorMessage ? opts.errorMessage.slice(0, 200) : null,
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneOldEntries(): Promise<void> {
    // Time-based prune: delete entries older than 14 days
    const result = await this.usageRepo
      .createQueryBuilder()
      .delete()
      .where("timestamp < datetime('now', '-14 days')")
      .execute();
    if (result.affected && result.affected > 0) {
      this.logger.log(`Pruned ${result.affected} usage log entries older than 14 days`);
    }

    // Hard cap: keep at most 5000 rows
    const count = await this.usageRepo.count();
    if (count > 5000) {
      const excess = count - 5000;
      await this.usageRepo
        .createQueryBuilder()
        .delete()
        .where(`id IN (SELECT id FROM mcp_usage_log ORDER BY timestamp ASC LIMIT :excess)`, { excess })
        .execute();
      this.logger.log(`Hard cap: deleted ${excess} oldest usage log entries (was ${count})`);
    }
  }

  async getOverview(): Promise<{ days: { date: string; totalCalls: number; errors: number; avgDurationMs: number }[] }> {
    const rows = await this.usageRepo
      .createQueryBuilder('log')
      .select("date(log.timestamp)", 'date')
      .addSelect('COUNT(*)', 'totalCalls')
      .addSelect("SUM(CASE WHEN log.success = 0 THEN 1 ELSE 0 END)", 'errors')
      .addSelect('ROUND(AVG(log.durationMs))', 'avgDurationMs')
      .groupBy('date')
      .orderBy('date', 'DESC')
      .getRawMany();

    return {
      days: rows.map((r) => ({
        date: r.date,
        totalCalls: Number(r.totalCalls),
        errors: Number(r.errors),
        avgDurationMs: Number(r.avgDurationMs),
      })),
    };
  }

  async getMcpTools(): Promise<{ tools: { toolName: string; totalCalls: number; avgDurationMs: number; p50Ms: number; p95Ms: number; maxDurationMs: number; errors: number; avgResultCount: number | null }[] }> {
    const rows = await this.usageRepo
      .createQueryBuilder('log')
      .select('log.toolName', 'toolName')
      .addSelect('COUNT(*)', 'totalCalls')
      .addSelect('ROUND(AVG(log.durationMs))', 'avgDurationMs')
      .addSelect('MAX(log.durationMs)', 'maxDurationMs')
      .addSelect("SUM(CASE WHEN log.success = 0 THEN 1 ELSE 0 END)", 'errors')
      .addSelect('ROUND(AVG(log.resultCount), 1)', 'avgResultCount')
      .groupBy('log.toolName')
      .orderBy('totalCalls', 'DESC')
      .getRawMany();

    // Compute P50/P95 per tool from sorted durations
    const toolNames = rows.map((r) => r.toolName);
    const percentiles = new Map<string, { p50: number; p95: number }>();
    for (const toolName of toolNames) {
      const durations = await this.usageRepo
        .createQueryBuilder('log')
        .select('log.durationMs', 'durationMs')
        .where('log.toolName = :toolName', { toolName })
        .orderBy('log.durationMs', 'ASC')
        .getRawMany();
      const sorted = durations.map((d) => Number(d.durationMs));
      percentiles.set(toolName, {
        p50: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0,
        p95: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      });
    }

    return {
      tools: rows.map((r) => {
        const p = percentiles.get(r.toolName) ?? { p50: 0, p95: 0 };
        return {
          toolName: r.toolName,
          totalCalls: Number(r.totalCalls),
          avgDurationMs: Number(r.avgDurationMs),
          p50Ms: p.p50,
          p95Ms: p.p95,
          maxDurationMs: Number(r.maxDurationMs),
          errors: Number(r.errors),
          avgResultCount: r.avgResultCount != null ? Number(r.avgResultCount) : null,
        };
      }),
    };
  }

  async getUsers(): Promise<{ users: { userId: number; email: string; totalCalls: number; lastActive: string; topTools: string[] }[] }> {
    const rows = await this.usageRepo
      .createQueryBuilder('log')
      .innerJoin('users', 'u', 'u.id = log.userId')
      .select('log.userId', 'userId')
      .addSelect('u.email', 'email')
      .addSelect('COUNT(*)', 'totalCalls')
      .addSelect('MAX(log.timestamp)', 'lastActive')
      .groupBy('log.userId')
      .orderBy('totalCalls', 'DESC')
      .getRawMany();

    const users = await Promise.all(
      rows.map(async (r) => {
        const topToolRows = await this.usageRepo
          .createQueryBuilder('log')
          .select('log.toolName', 'toolName')
          .addSelect('COUNT(*)', 'cnt')
          .where('log.userId = :userId', { userId: r.userId })
          .groupBy('log.toolName')
          .orderBy('cnt', 'DESC')
          .limit(3)
          .getRawMany();

        return {
          userId: Number(r.userId),
          email: r.email,
          totalCalls: Number(r.totalCalls),
          lastActive: r.lastActive,
          topTools: topToolRows.map((t: { toolName: string }) => t.toolName),
        };
      }),
    );

    return { users };
  }

  async getSystemHealth(runtimeStats: RuntimeStats): Promise<Record<string, unknown>> {
    // DB file size
    const [{ size }] = await this.dataSource.query(`SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()`);

    // Table row counts
    const tableCounts: Record<string, number> = {};
    for (const table of ['notes_fts', 'note_embeddings', 'comments_fts', 'mcp_usage_log', 'daily_stats', 'failed_searches']) {
      try {
        const [{ cnt }] = await this.dataSource.query(`SELECT COUNT(*) as cnt FROM "${table}"`);
        tableCounts[table] = Number(cnt);
      } catch {
        tableCounts[table] = 0;
      }
    }

    // Embedding coverage
    let embeddingCoverage = { indexedNotes: 0, totalNotes: 0, percentage: 0 };
    try {
      const [{ indexed }] = await this.dataSource.query(
        `SELECT COUNT(DISTINCT path) as indexed FROM note_embeddings WHERE source = 'note'`,
      );
      const [{ total }] = await this.dataSource.query(`SELECT COUNT(*) as total FROM notes_fts`);
      const indexedN = Number(indexed);
      const totalN = Number(total);
      embeddingCoverage = {
        indexedNotes: indexedN,
        totalNotes: totalN,
        percentage: totalN > 0 ? Math.round((indexedN / totalN) * 100) : 0,
      };
    } catch {}

    // FTS coverage
    let ftsCoverage = { indexedNotes: 0, totalFiles: 0, percentage: 0 };
    try {
      const [{ indexed }] = await this.dataSource.query(`SELECT COUNT(*) as indexed FROM notes_fts`);
      ftsCoverage.indexedNotes = Number(indexed);
      // totalFiles is a best effort — use the same count as indexed since we don't have easy access to disk
      ftsCoverage.totalFiles = ftsCoverage.indexedNotes;
      ftsCoverage.percentage = 100;
    } catch {}

    // Vault stats
    let vaultStats = { noteCount: 0, attachmentCount: 0, attachmentSizeBytes: 0, openThreads: 0, resolvedThreads: 0 };
    try {
      const [{ cnt }] = await this.dataSource.query(`SELECT COUNT(*) as cnt FROM notes_fts`);
      vaultStats.noteCount = Number(cnt);
    } catch {}
    try {
      const paths: { path: string }[] = await this.dataSource.query(
        `SELECT DISTINCT path FROM comments_fts`,
      );
      for (const { path } of paths) {
        const threads = await this.sidecarService.getThreadsForDocument(path);
        for (const thread of threads) {
          if (thread.resolved) {
            vaultStats.resolvedThreads++;
          } else {
            vaultStats.openThreads++;
          }
        }
      }
    } catch {}

    return {
      db: {
        fileSizeBytes: Number(size),
        tables: tableCounts,
        embeddingCoverage,
        ftsCoverage,
      },
      vault: vaultStats,
      runtime: runtimeStats,
    };
  }

  async getAppStats(): Promise<{ days: unknown[]; failedSearches: unknown[] }> {
    const days = await this.dailyStatsService.getDailyStats();
    const failedSearches = await this.dailyStatsService.getFailedSearches();
    return { days, failedSearches };
  }
}
