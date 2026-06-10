import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OAuthService } from './oauth.service';

// Scheduled GC for OAuth artifacts. Three concerns:
//   - keep the token tables small (expired access tokens, expired auth codes
//     and authorization requests)
//   - revoke grants whose refresh chain has gone idle (no rotation in 30 days)
//   - delete unused DCR clients (Decision 19)
//
// Cron schedules reuse @nestjs/schedule (already present in app.module). The
// per-minute hot loops also run a small in-process tick so a bursty creation
// doesn't have to wait an hour for cleanup.
@Injectable()
export class OAuthSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OAuthSweepService.name);
  private hotInterval?: ReturnType<typeof setInterval>;

  constructor(private readonly oauth: OAuthService) {}

  onModuleInit(): void {
    // Light-touch sweep every 5 minutes for expired access tokens and codes.
    this.hotInterval = setInterval(() => {
      this.sweepHot().catch((err) => this.logger.warn(`Hot sweep failed: ${err.message}`));
    }, 5 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.hotInterval) clearInterval(this.hotInterval);
  }

  private async sweepHot(): Promise<void> {
    const now = new Date();
    const accessDeleted = await this.oauth.sweepExpiredAccessTokens(now);
    const codesDeleted = await this.oauth.sweepExpiredAuthorizationArtifacts(now);
    if (accessDeleted + codesDeleted > 0) {
      this.logger.debug(
        `OAuth hot sweep: deleted ${accessDeleted} access tokens, ${codesDeleted} codes/requests`,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async nightlyMaintenance(): Promise<void> {
    const now = new Date();
    const idleRevoked = await this.oauth.sweepIdleExpiredGrants(now);
    const oldDeleted = await this.oauth.deleteRevokedGrantsOlderThan(90, now);
    const dcrDeleted = await this.oauth.sweepUnusedDcrClients(now);
    this.logger.log(
      `OAuth nightly: idle-grants revoked=${idleRevoked}, revoked-grants deleted=${oldDeleted}, DCR clients deleted=${dcrDeleted}`,
    );
  }
}
