import { Controller, Get, Post, Body, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { PinService } from '../pin/pin.service';
import { LinkIndexService } from './link-index.service';

@Controller('api/links')
@UseGuards(CombinedAuthGuard)
export class LinksController {
  constructor(
    private readonly linkIndexService: LinkIndexService,
    private readonly visibility: GrantAwareVisibility,
    private readonly pinService: PinService,
  ) {}

  /**
   * The line quoted around a link or a mention is the linking note's text, so
   * it stays behind that note's PIN unless this request carries its unlock
   * credential — the rule search and MCP get_links apply. Otherwise
   * unlinked-mentions, which takes any `<word>.md`, would read locked notes
   * line by line.
   */
  private async withoutLockedContext<T extends { sourcePath: string; context: string | null }>(
    entries: T[],
    req: Request & { user: JwtPayload },
  ): Promise<T[]> {
    const unlocked = new Map<string, boolean>();
    const out: T[] = [];
    for (const e of entries) {
      if (!unlocked.has(e.sourcePath)) {
        unlocked.set(e.sourcePath, await this.pinService.isUnlockedForRequest(req, e.sourcePath, req.user.email));
      }
      out.push(unlocked.get(e.sourcePath) ? e : { ...e, context: '', pinProtected: true });
    }
    return out;
  }

  @Get('backlinks')
  @RequiredScope('links:read')
  async getBacklinks(@Query('path') filePath: string, @Req() req: Request & { user: JwtPayload }) {
    return this.withoutLockedContext(await this.linkIndexService.getBacklinks(filePath, req.user.email), req);
  }

  @Get('outgoing')
  @RequiredScope('links:read')
  async getOutgoingLinks(@Query('path') filePath: string, @Req() req: { user: JwtPayload }) {
    return this.linkIndexService.getOutgoingLinks(filePath, req.user.email);
  }

  @Get('unlinked-mentions')
  @RequiredScope('links:read')
  async getUnlinkedMentions(@Query('path') filePath: string, @Req() req: Request & { user: JwtPayload }) {
    return this.withoutLockedContext(await this.linkIndexService.getUnlinkedMentions(filePath, req.user.email), req);
  }

  @Get('graph')
  @RequiredScope('links:read')
  async getGraph(
    @Req() req: { user: JwtPayload },
    @Query('path') filePath?: string,
    @Query('depth') depth?: string,
  ) {
    return this.linkIndexService.getGraphData(
      filePath || undefined,
      depth ? parseInt(depth, 10) : undefined,
      req.user.email,
    );
  }

  @Post('convert-mention')
  @RequiredScope('notes:edit')
  async convertMention(
    @Body() body: { sourcePath: string; lineNumber: number; title: string },
    @Req() req: { user: JwtPayload },
  ) {
    // convert-mention writes to body.sourcePath; gate accordingly.
    await this.visibility.assertWritableBy(body.sourcePath, req.user.email);
    await this.linkIndexService.convertMention(body.sourcePath, body.lineNumber, body.title);
    return { ok: true };
  }
}
