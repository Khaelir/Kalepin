import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { DocHandlesModule } from '../doc-handles';
import { TemplatesService } from './templates.service';
import { DailyNotesController, TemplatesController } from './templates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule, FilesModule, DocHandlesModule],
  controllers: [TemplatesController, DailyNotesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
