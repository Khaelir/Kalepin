import { Global, Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { OTModule } from '../ot/ot.module';
import { NoteLink } from '../entities';
import { LinksController } from './links.controller';
import { LinkIndexService } from './link-index.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NoteLink]), AuthModule, FilesModule, forwardRef(() => OTModule)],
  controllers: [LinksController],
  providers: [
    LinkIndexService,
    {
      provide: 'LINK_INDEX_SERVICE',
      useExisting: LinkIndexService,
    },
  ],
  exports: [LinkIndexService, 'LINK_INDEX_SERVICE'],
})
export class LinksModule implements OnModuleInit {
  constructor(private readonly linkIndexService: LinkIndexService) {}

  async onModuleInit() {
    await this.linkIndexService.onModuleInit();
  }
}
