import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DailyStats } from '../entities/daily-stats.entity';
import { FailedSearch } from '../entities/failed-search.entity';

interface DayCounters {
  searches: number;
  searches_empty: number;
  notes_created: number;
  notes_edited: number;
  comments_added: number;
  comments_resolved: number;
  ot_concurrent_edits: number;
  activeUsers: Set<number>;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyCounters(): DayCounters {
  return {
    searches: 0,
    searches_empty: 0,
    notes_created: 0,
    notes_edited: 0,
    comments_added: 0,
    comments_resolved: 0,
    ot_concurrent_edits: 0,
    activeUsers: new Set(),
  };
}

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FAILED_SEARCH_CAP = 100;

@Injectable()
export class DailyStatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyStatsService.name);
  private counters: DayCounters = emptyCounters();
  private currentDate: string = todayKey();
  private flushTimer?: ReturnType<typeof setInterval>;
  private shutdownHandlersBound = false;

  constructor(
    @InjectRepository(DailyStats)
    private readonly dailyStatsRepo: Repository<DailyStats>,
    @InjectRepository(FailedSearch)
    private readonly failedSearchRepo: Repository<FailedSearch>,
  ) {}

  async onModuleInit() {
    await this.pruneOldDailyStats();
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => this.logger.error('Failed to flush daily stats', err));
    }, FLUSH_INTERVAL_MS);

    if (!this.shutdownHandlersBound) {
      this.shutdownHandlersBound = true;
      const onShutdown = () => {
        this.flush().catch(() => {}).finally(() => process.exit());
      };
      process.on('SIGTERM', onShutdown);
      process.on('SIGINT', onShutdown);
    }
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  // --- Counter increment methods ---

  trackSearch(empty: boolean): void {
    this.rollDateIfNeeded();
    this.counters.searches++;
    if (empty) this.counters.searches_empty++;
  }

  trackNoteCreated(): void {
    this.rollDateIfNeeded();
    this.counters.notes_created++;
  }

  trackNoteEdited(): void {
    this.rollDateIfNeeded();
    this.counters.notes_edited++;
  }

  trackCommentAdded(): void {
    this.rollDateIfNeeded();
    this.counters.comments_added++;
  }

  trackCommentResolved(): void {
    this.rollDateIfNeeded();
    this.counters.comments_resolved++;
  }

  trackOtConcurrentEdit(): void {
    this.rollDateIfNeeded();
    this.counters.ot_concurrent_edits++;
  }

  trackActiveUser(userId: number): void {
    this.rollDateIfNeeded();
    this.counters.activeUsers.add(userId);
  }

  // --- Flush logic ---

  async flush(): Promise<void> {
    const date = this.currentDate;
    const c = this.counters;

    // Nothing to flush if all counters are zero
    if (
      c.searches === 0 &&
      c.searches_empty === 0 &&
      c.notes_created === 0 &&
      c.notes_edited === 0 &&
      c.comments_added === 0 &&
      c.comments_resolved === 0 &&
      c.ot_concurrent_edits === 0 &&
      c.activeUsers.size === 0
    ) {
      return;
    }

    const activeUserCount = c.activeUsers.size;

    // Upsert: merge with any existing row for this date
    const existing = await this.dailyStatsRepo.findOne({ where: { date } });
    if (existing) {
      existing.active_users = Math.max(existing.active_users, activeUserCount);
      existing.searches += c.searches;
      existing.searches_empty += c.searches_empty;
      existing.notes_created += c.notes_created;
      existing.notes_edited += c.notes_edited;
      existing.comments_added += c.comments_added;
      existing.comments_resolved += c.comments_resolved;
      existing.ot_concurrent_edits += c.ot_concurrent_edits;
      await this.dailyStatsRepo.save(existing);
    } else {
      await this.dailyStatsRepo.insert({
        date,
        active_users: activeUserCount,
        searches: c.searches,
        searches_empty: c.searches_empty,
        notes_created: c.notes_created,
        notes_edited: c.notes_edited,
        comments_added: c.comments_added,
        comments_resolved: c.comments_resolved,
        ot_concurrent_edits: c.ot_concurrent_edits,
      });
    }

    // Reset counters
    this.counters = emptyCounters();
    this.currentDate = todayKey();
  }

  // --- Failed search logging ---

  async logFailedSearch(query: string, source: 'frontend' | 'mcp'): Promise<void> {
    // FIFO eviction: if at capacity, delete the oldest row
    const count = await this.failedSearchRepo.count();
    if (count >= FAILED_SEARCH_CAP) {
      const oldest = await this.failedSearchRepo.find({
        order: { timestamp: 'ASC' },
        take: count - FAILED_SEARCH_CAP + 1,
      });
      if (oldest.length > 0) {
        await this.failedSearchRepo.remove(oldest);
      }
    }

    await this.failedSearchRepo.insert({ query, source });
  }

  // --- Query methods ---

  async getDailyStats(): Promise<DailyStats[]> {
    return this.dailyStatsRepo.find({ order: { date: 'DESC' } });
  }

  async getFailedSearches(): Promise<FailedSearch[]> {
    return this.failedSearchRepo.find({ order: { timestamp: 'DESC' } });
  }

  // --- Pruning ---

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneOldDailyStats(): Promise<void> {
    const result = await this.dailyStatsRepo
      .createQueryBuilder()
      .delete()
      .where("date < date('now', '-90 days')")
      .execute();
    if (result.affected && result.affected > 0) {
      this.logger.log(`Pruned ${result.affected} daily_stats entries older than 90 days`);
    }
  }

  // --- Internal helpers ---

  private rollDateIfNeeded(): void {
    const today = todayKey();
    if (today !== this.currentDate) {
      // Day has rolled over — flush previous day's counters
      this.flush().catch((err) => this.logger.error('Failed to flush on date roll', err));
      this.currentDate = today;
      this.counters = emptyCounters();
    }
  }
}
