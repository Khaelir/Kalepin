import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule, OAuthModule } from '../auth';
import { StorageModule } from '../storage';
import { McpUsageLog } from '../entities/mcp-usage-log.entity';
import { DailyStats } from '../entities/daily-stats.entity';
import { FailedSearch } from '../entities/failed-search.entity';
import { SidecarService } from '../comments/sidecar.service';
import { StatsService } from './stats.service';
import { DailyStatsService } from './daily-stats.service';
import { StatsController } from './stats.controller';
import { OAuthUsageLogger } from './oauth-usage-logger.service';

@Module({
  imports: [TypeOrmModule.forFeature([McpUsageLog, DailyStats, FailedSearch]), AuthModule, OAuthModule, StorageModule],
  controllers: [StatsController],
  providers: [StatsService, DailyStatsService, SidecarService, OAuthUsageLogger],
  exports: [StatsService, DailyStatsService],
})
export class StatsModule {}
