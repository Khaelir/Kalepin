import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { TagIndexService } from './tag-index.service';
import { normalizeTagKey } from './tag-parser';

@Controller('api/tags')
@UseGuards(CombinedAuthGuard)
export class TagsController {
  constructor(private readonly tagIndex: TagIndexService) {}

  @Get()
  @RequiredScope('notes:read')
  async list(@Req() req: { user: JwtPayload }) {
    return this.tagIndex.listTags(req.user.email);
  }

  @Get('notes')
  @RequiredScope('notes:read')
  async notes(@Req() req: { user: JwtPayload }, @Query('tag') tag?: string) {
    if (!tag || !normalizeTagKey(tag)) {
      throw new BadRequestException('Missing query parameter "tag"');
    }
    return this.tagIndex.notesForTags([tag], req.user.email);
  }
}
