import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from './doc-handles.service';

@Module({
  imports: [TypeOrmModule.forFeature([DocHandle])],
  providers: [DocHandlesService],
  exports: [DocHandlesService],
})
export class DocHandlesModule {}
