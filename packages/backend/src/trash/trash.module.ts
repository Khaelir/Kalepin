import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrashItem, StarredItem, NoteMeta } from '../entities';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { ChangesModule } from '../changes';
import { ShareLinksModule } from '../share-links';
import { GrantsModule } from '../grants';
import { DocHandlesModule } from '../doc-handles';
import { TrashService } from './trash.service';
import { TrashController } from './trash.controller';
import { TrashRetentionService } from './trash-retention.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrashItem, StarredItem, NoteMeta]),
    AuthModule,
    FilesModule,
    ChangesModule,
    ShareLinksModule,
    GrantsModule,
    DocHandlesModule,
  ],
  controllers: [TrashController],
  providers: [TrashService, TrashRetentionService],
  exports: [TrashService],
})
export class TrashModule {}
