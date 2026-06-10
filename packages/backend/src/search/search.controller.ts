import { Controller, Get, Post, Query, Req, BadRequestException, UseGuards } from '@nestjs/common';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { SearchService } from './search.service';

@Controller('api')
@UseGuards(CombinedAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('files/search')
  @RequiredScope('notes:search')
  async search(@Query('q') query: string, @Req() req: { user: JwtPayload }) {
    if (!query) {
      throw new BadRequestException('Missing query parameter "q"');
    }
    return this.searchService.search(query, 'frontend', req.user.email);
  }

  @Post('search/reindex')
  @RequiredScope('admin:backup')
  async reindex() {
    const count = await this.searchService.reindexAll();
    return { indexed: count };
  }
}
