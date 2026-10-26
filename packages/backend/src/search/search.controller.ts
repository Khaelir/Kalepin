import { Controller, Get, Post, Query, Req, BadRequestException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { PinService } from '../pin/pin.service';
import { SearchService, SearchResult } from './search.service';

type PinProtectedResult = { path: string; snippet: ''; score: number; kind: 'pin-protected' };

@Controller('api')
@UseGuards(CombinedAuthGuard)
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly pinService: PinService,
  ) {}

  @Get('files/search')
  @RequiredScope('notes:search')
  async search(@Query('q') query: string, @Req() req: Request & { user: JwtPayload }) {
    if (!query) {
      throw new BadRequestException('Missing query parameter "q"');
    }
    const results = await this.searchService.search(query, 'frontend', req.user.email);

    // Snippets, chunks and comment threads are note content: a PIN-locked
    // note is listed once, by path only, unless this request carries its
    // unlock credential. Same rule as MCP search_notes.
    const unlocked = new Map<string, boolean>();
    const out: (SearchResult | PinProtectedResult)[] = [];
    for (const r of results) {
      const firstHit = !unlocked.has(r.path);
      if (firstHit) unlocked.set(r.path, await this.pinService.isUnlockedForRequest(req, r.path, req.user.email));
      if (unlocked.get(r.path)) out.push(r);
      else if (firstHit) out.push({ path: r.path, snippet: '', score: r.score, kind: 'pin-protected' });
    }
    return out;
  }

  @Post('search/reindex')
  @RequiredScope('admin:backup')
  async reindex() {
    const count = await this.searchService.reindexAll();
    return { indexed: count };
  }
}
