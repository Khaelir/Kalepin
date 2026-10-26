import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { User, Session, MagicLinkToken, OTOperationHistory, ApiKey, NoteChange, StarredItem, NoteLink, NoteSnapshot, McpUsageLog, MentionNotification, DailyStats, FailedSearch, ShortLink, DocHandle, OAuthClient, OAuthAuthorizationRequest, OAuthAuthorizationCode, OAuthGrant, OAuthAccessToken, OAuthRefreshToken, EncryptionZone, NoteMeta, DocumentGrant, NoteAccessLog, SsoLoginRequest, UserIdentity } from './entities';
import { StorageModule } from './storage';
import { EncryptionModule } from './encryption/encryption.module';
import { AuthModule, OAuthModule, SsoModule } from './auth';
import { FilesModule } from './files';
import { OTModule } from './ot';
import { CommentsModule } from './comments';
import { AttachmentsModule } from './attachments';
import { SearchModule } from './search';
import { McpModule } from './mcp/mcp.module';
import { ChangesModule } from './changes';
import { StarsModule } from './stars';
import { ShareLinksModule } from './share-links';
import { DocHandlesModule } from './doc-handles';
import { PinModule } from './pin';
import { GrantsModule } from './grants';
import { AccessLogModule } from './access-log/access-log.module';
import { LinksModule } from './links/links.module';
import { BackupModule } from './backup/backup.module';
import { ArchiveModule } from './archive/archive.module';
import { StatsModule } from './stats/stats.module';
import { ActiveUserInterceptor } from './stats/active-user.interceptor';
import { HealthController } from './health.controller';
import { TestDebugModule } from './__test/test-debug.module';

@Module({
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ActiveUserInterceptor },
  ],
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH || './data/kalepin.sqlite',
      entities: [User, Session, MagicLinkToken, OTOperationHistory, ApiKey, NoteChange, StarredItem, NoteLink, NoteSnapshot, McpUsageLog, MentionNotification, DailyStats, FailedSearch, ShortLink, DocHandle, OAuthClient, OAuthAuthorizationRequest, OAuthAuthorizationCode, OAuthGrant, OAuthAccessToken, OAuthRefreshToken, EncryptionZone, NoteMeta, DocumentGrant, NoteAccessLog, SsoLoginRequest, UserIdentity],
      synchronize: true,
    }),
    // CORS for /drawio/ is handled by the Express middleware in main.ts
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', '..', '..', 'frontend', 'dist'),
      exclude: ['/api/{*path}', '/ws', '/mcp', '/.well-known/{*path}', '/drawio/{*path}', '/oauth/{*path}', '/docs/{*path}'],
    }),
    ScheduleModule.forRoot(),
    EncryptionModule,
    StorageModule,
    AuthModule,
    OAuthModule,
    SsoModule,
    FilesModule,
    OTModule,
    CommentsModule,
    AttachmentsModule,
    SearchModule,
    McpModule,
    ChangesModule,
    StarsModule,
    ShareLinksModule,
    DocHandlesModule,
    PinModule,
    GrantsModule,
    AccessLogModule,
    LinksModule,
    ArchiveModule,
    StatsModule,
    ...(process.env.S3_BACKUP_BUCKET ? [BackupModule] : []),
    // Phase 4 leak-token e2e harness: route + MCP-tool discovery + notification
    // counters. Loaded only when explicitly enabled.
    ...(process.env.EXPOSE_TEST_ENDPOINTS === '1' ? [TestDebugModule] : []),
  ],
})
export class AppModule {}
