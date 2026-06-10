import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth';
import { ChangesModule } from '../changes';
import { StatsModule } from '../stats/stats.module';
import { ShareLinksModule } from '../share-links';
import { AttachmentsModule } from '../attachments/attachments.module';
import { GrantsModule } from '../grants';
import { PinModule } from '../pin';
import { DocHandlesModule } from '../doc-handles';
import { NoteChange, StarredItem } from '../entities';
import { FilesController } from './files.controller';
import { VaultController } from './vault.controller';
import { SecureFilesController } from './secure-files.controller';
import { FilesService } from './files.service';
import { SecureFilesService } from './secure-files.service';
import { FileWatcherService } from './file-watcher.service';
import { RenameTrackingService } from './rename-tracking.service';

@Module({
  imports: [TypeOrmModule.forFeature([NoteChange, StarredItem]), AuthModule, ChangesModule, StatsModule, ShareLinksModule, AttachmentsModule, GrantsModule, PinModule, DocHandlesModule],
  controllers: [FilesController, VaultController, SecureFilesController],
  providers: [FilesService, FileWatcherService, RenameTrackingService, SecureFilesService],
  exports: [FilesService, FileWatcherService],
})
export class FilesModule {}
