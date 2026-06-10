import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { ArchiveService } from './archive.service';
import { ArchiveController } from './archive.controller';

@Module({
  imports: [AuthModule],
  controllers: [ArchiveController],
  providers: [ArchiveService],
  exports: [ArchiveService],
})
export class ArchiveModule {}
