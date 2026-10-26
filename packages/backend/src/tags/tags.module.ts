import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { TagsController } from './tags.controller';
import { TagIndexService } from './tag-index.service';

/** Global so SearchService and McpService can use the index without importing this module. */
@Global()
@Module({
  imports: [AuthModule, FilesModule],
  controllers: [TagsController],
  providers: [TagIndexService],
  exports: [TagIndexService],
})
export class TagsModule {}
