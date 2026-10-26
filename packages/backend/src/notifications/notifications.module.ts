import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxNotification } from '../entities/inbox-notification.entity';
import { User } from '../entities/user.entity';
import { DocHandle } from '../entities/doc-handle.entity';
import { AuthModule } from '../auth';
import { DocHandlesModule } from '../doc-handles/doc-handles.module';
import { NotificationService } from '../comments/notification.service';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationRetentionService } from './notification-retention.service';
import { NotificationsController } from './notifications.controller';
import { UnsubscribeController } from './unsubscribe.controller';

/**
 * In-app inbox, email preferences, and the email `NotificationService` itself.
 * Global so the comment, doc-mention, grant and OT chokepoints can all reach
 * it without importing CommentsModule (which would close a module cycle).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([InboxNotification, User, DocHandle]), AuthModule, DocHandlesModule],
  controllers: [NotificationsController, UnsubscribeController],
  providers: [
    NotificationService,
    NotificationInboxService,
    NotificationPreferencesService,
    NotificationRetentionService,
  ],
  exports: [NotificationService, NotificationInboxService, NotificationPreferencesService],
})
export class NotificationsModule {}
