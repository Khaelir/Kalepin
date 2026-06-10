import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoteChange, NoteSnapshot, User, StarredItem } from '../entities';
import { AuthModule } from '../auth';
import { ChangeTrackingService } from './change-tracking.service';
import { VersionHistoryService } from './version-history.service';
import { UpdatesController } from './updates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NoteChange, NoteSnapshot, User, StarredItem]), AuthModule],
  controllers: [UpdatesController],
  providers: [ChangeTrackingService, VersionHistoryService],
  exports: [ChangeTrackingService, VersionHistoryService],
})
export class ChangesModule implements OnModuleInit {
  private readonly logger = new Logger(ChangesModule.name);
  private pruneInterval?: ReturnType<typeof setInterval>;

  constructor(private readonly changeTracking: ChangeTrackingService) {}

  async onModuleInit() {
    await this.changeTracking.pruneVersionHistory();

    // Schedule daily pruning (every 24 hours)
    this.pruneInterval = setInterval(
      () => {
        this.changeTracking.pruneVersionHistory().catch((err) => {
          this.logger.error('Scheduled prune failed', err);
        });
      },
      24 * 60 * 60 * 1000,
    );
  }
}
