import { Module } from '@nestjs/common';
import { AuthModule, OAuthModule } from '../auth';
import { FilesModule } from '../files';
import { SearchModule } from '../search/search.module';
import { CommentsModule } from '../comments/comments.module';
import { ChangesModule } from '../changes';
import { BackupModule } from '../backup/backup.module';
import { StatsModule } from '../stats/stats.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { OTModule } from '../ot';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [
    AuthModule,
    OAuthModule,
    FilesModule,
    SearchModule,
    CommentsModule,
    ChangesModule,
    StatsModule,
    AttachmentsModule,
    OTModule,
    ...(process.env.S3_BACKUP_BUCKET ? [BackupModule] : []),
  ],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
