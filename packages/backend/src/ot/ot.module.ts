import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OTOperationHistory } from '../entities';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { ChangesModule } from '../changes';
import { StatsModule } from '../stats/stats.module';
import { CommentsModule } from '../comments/comments.module';
import { DocHandlesModule } from '../doc-handles';
import { OTService } from './ot.service';
import { OTGateway } from './ot.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([OTOperationHistory]),
    AuthModule,
    // FilesModule → ShareLinksModule → CommentsModule → SearchModule → OTModule
    // closes back here. Every other edge on that loop uses forwardRef; without
    // one here, Node re-enters the half-evaluated files/index.ts and the named
    // export resolves to `undefined` (UndefinedModuleException at index [2]).
    forwardRef(() => FilesModule),
    ChangesModule,
    StatsModule,
    forwardRef(() => CommentsModule),
    DocHandlesModule,
  ],
  providers: [OTService, OTGateway],
  exports: [OTService],
})
export class OTModule {}
