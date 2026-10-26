import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationInboxService } from './notification-inbox.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily prune of read inbox items. Retention defaults to 90 days; configurable
 * via `NOTIFICATION_RETENTION_DAYS` (0 disables). Unread items are never pruned.
 */
@Injectable()
export class NotificationRetentionService {
  private readonly logger = new Logger(NotificationRetentionService.name);

  constructor(private readonly inbox: NotificationInboxService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(now: number = Date.now()): Promise<number> {
    const days = notificationRetentionDays();
    if (days <= 0) return 0;
    const deleted = await this.inbox.deleteReadOlderThan(now - days * DAY_MS);
    if (deleted > 0) {
      this.logger.log(`notification retention: pruned ${deleted} read items older than ${days}d`);
    }
    return deleted;
  }
}

export function notificationRetentionDays(): number {
  const raw = process.env.NOTIFICATION_RETENTION_DAYS;
  if (raw === undefined || raw === '') return 90;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 90;
  return Math.floor(n);
}
