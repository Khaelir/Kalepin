import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccessLogService } from './access-log.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily prune of `note_access_log`. Retention defaults to 90 days; configurable
 * via `ACCESS_LOG_RETENTION_DAYS`. Setting it to 0 disables retention (the
 * README warns about GDPR implications).
 */
@Injectable()
export class AccessLogRetentionService {
  private readonly logger = new Logger(AccessLogRetentionService.name);

  constructor(private readonly accessLog: AccessLogService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    const days = retentionDays();
    if (days <= 0) return;
    const cutoff = Date.now() - days * DAY_MS;
    const deleted = await this.accessLog.deleteOlderThan(cutoff);
    if (deleted > 0) {
      this.logger.log(`access-log retention: pruned ${deleted} rows older than ${days}d`);
    }
  }
}

export function retentionDays(): number {
  const raw = process.env.ACCESS_LOG_RETENTION_DAYS;
  if (raw === undefined || raw === '') return 90;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 90;
  return Math.floor(n);
}
