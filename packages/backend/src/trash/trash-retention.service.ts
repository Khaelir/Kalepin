import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TrashService } from './trash.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Daily purge of trash items older than `TRASH_RETENTION_DAYS` (default 30).
 * Setting it to 0 keeps trashed items until someone purges them.
 */
@Injectable()
export class TrashRetentionService {
  private readonly logger = new Logger(TrashRetentionService.name);

  constructor(private readonly trash: TrashService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(): Promise<void> {
    const days = trashRetentionDays();
    if (days <= 0) return;
    const purged = await this.trash.purgeOlderThan(Date.now() - days * DAY_MS);
    if (purged > 0) {
      this.logger.log(`trash retention: purged ${purged} items older than ${days}d`);
    }
  }
}

export function trashRetentionDays(): number {
  const raw = process.env.TRASH_RETENTION_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_DAYS;
  return Math.floor(n);
}
