import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth';
import { SearchModule } from '../search/search.module';
import { StarsModule } from '../stars/stars.module';
import { StatsModule } from '../stats/stats.module';
import { ShareLinksModule } from '../share-links';
import { DocHandlesModule } from '../doc-handles/doc-handles.module';
import { StorageModule } from '../storage';
import { MentionNotification } from '../entities/mention-notification.entity';
import { User } from '../entities/user.entity';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { SidecarService } from './sidecar.service';
import { NotificationService } from './notification.service';
import { MentionTrackingService } from './mention-tracking.service';
import { DocMentionService } from './doc-mention.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MentionNotification, User]),
    AuthModule,
    forwardRef(() => SearchModule),
    StarsModule,
    StatsModule,
    forwardRef(() => ShareLinksModule),
    DocHandlesModule,
    StorageModule,
  ],
  controllers: [CommentsController],
  providers: [CommentsService, SidecarService, NotificationService, MentionTrackingService, DocMentionService],
  exports: [CommentsService, SidecarService, NotificationService, MentionTrackingService, DocMentionService],
})
export class CommentsModule implements OnModuleInit {
  constructor(private readonly mentionTracking: MentionTrackingService) {}

  async onModuleInit() {
    await this.mentionTracking.backfillExistingMentions();
  }
}
