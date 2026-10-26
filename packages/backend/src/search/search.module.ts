import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { CommentsModule } from '../comments/comments.module';
import { StatsModule } from '../stats/stats.module';
import { OTModule } from '../ot/ot.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { EmbeddingService } from './embedding.service';
import { RelatedNotesService } from './related-notes.service';
import { RelatedNotesController } from './related-notes.controller';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => FilesModule),
    forwardRef(() => CommentsModule),
    StatsModule,
    forwardRef(() => OTModule),
  ],
  controllers: [SearchController, RelatedNotesController],
  providers: [EmbeddingService, SearchService, RelatedNotesService],
  exports: [SearchService, RelatedNotesService],
})
export class SearchModule {}
