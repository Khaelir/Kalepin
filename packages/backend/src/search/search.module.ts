import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { CommentsModule } from '../comments/comments.module';
import { StatsModule } from '../stats/stats.module';
import { OTModule } from '../ot/ot.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => FilesModule),
    forwardRef(() => CommentsModule),
    StatsModule,
    forwardRef(() => OTModule),
  ],
  controllers: [SearchController],
  providers: [EmbeddingService, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
