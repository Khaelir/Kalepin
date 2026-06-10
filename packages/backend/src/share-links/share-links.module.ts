import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShortLink } from '../entities';
import { AuthModule } from '../auth';
import { StorageModule } from '../storage';
import { AttachmentsModule } from '../attachments';
import { CommentsModule } from '../comments/comments.module';
import { DocHandlesModule } from '../doc-handles';
import { ShareLinksController } from './share-links.controller';
import { ShareLinksService } from './share-links.service';
import { ScopedTokenService } from './scoped-token.service';
import { ShareLinkScopeGuard } from './share-link-scope.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { AnonymousRateLimitGuard } from './rate-limit.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShortLink]),
    AuthModule,
    StorageModule,
    AttachmentsModule,
    forwardRef(() => CommentsModule),
    DocHandlesModule,
  ],
  controllers: [ShareLinksController],
  providers: [
    ShareLinksService,
    ScopedTokenService,
    ShareLinkScopeGuard,
    OptionalAuthGuard,
    AnonymousRateLimitGuard,
  ],
  exports: [ShareLinksService, ScopedTokenService],
})
export class ShareLinksModule {}
