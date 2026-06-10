import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  OAuthEventBus,
  type OAuthRefreshEvent,
  type OAuthGrantRevokedEvent,
} from '../auth/oauth/oauth.events';
import { StatsService } from './stats.service';

const TOOL_NAME_BY_REFRESH_KIND: Record<OAuthRefreshEvent['kind'], string> = {
  refresh: 'oauth.refresh',
  leeway: 'oauth.refresh.leeway',
  replay_detected: 'oauth.refresh.replay_detected',
};

// Subscribes to OAuthEventBus and persists OAuth lifecycle events into the
// shared mcp_usage_log table so audits and dashboards have a single source
// of truth (Decision 20). Lives in StatsModule to keep OAuthService unaware
// of the persistence target.
@Injectable()
export class OAuthUsageLogger implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OAuthUsageLogger.name);
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly events: OAuthEventBus,
    private readonly stats: StatsService,
  ) {}

  onModuleInit(): void {
    this.unsubscribers.push(
      this.events.onRefresh((ev) => this.handleRefresh(ev)),
      this.events.onGrantRevoked((ev) => this.handleGrantRevoked(ev)),
    );
  }

  onModuleDestroy(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }

  private handleRefresh(ev: OAuthRefreshEvent): void {
    const toolName = TOOL_NAME_BY_REFRESH_KIND[ev.kind];
    this.stats
      .logToolCall(toolName, ev.userId, null, ev.durationMs, ev.success, ev.errorMessage, {
        grantId: ev.grantId,
        errorMessage: ev.errorMessage,
      })
      .catch((err) => this.logger.warn(`Failed to log ${toolName}: ${err.message}`));
  }

  private handleGrantRevoked(ev: OAuthGrantRevokedEvent): void {
    this.stats
      .logToolCall('oauth.grant.revoked', ev.userId, null, 0, true, ev.reason, {
        grantId: ev.grantId,
        errorMessage: `reason=${ev.reason}`,
      })
      .catch((err) => this.logger.warn(`Failed to log oauth.grant.revoked: ${err.message}`));
  }
}
