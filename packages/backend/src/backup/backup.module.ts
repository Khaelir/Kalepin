import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { ArchiveModule } from '../archive/archive.module';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

@Module({
  imports: [AuthModule, ArchiveModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
