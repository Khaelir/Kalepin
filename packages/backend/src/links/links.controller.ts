import { Controller, Get, Post, Body, Query, Req, UseGuards } from '@nestjs/common';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { LinkIndexService } from './link-index.service';

@Controller('api/links')
@UseGuards(CombinedAuthGuard)
export class LinksController {
  constructor(
    private readonly linkIndexService: LinkIndexService,
    private readonly visibility: GrantAwareVisibility,
  ) {}

  @Get('backlinks')
  @RequiredScope('links:read')
  async getBacklinks(@Query('path') filePath: string, @Req() req: { user: JwtPayload }) {
    return this.linkIndexService.getBacklinks(filePath, req.user.email);
  }

  @Get('outgoing')
  @RequiredScope('links:read')
  async getOutgoingLinks(@Query('path') filePath: string, @Req() req: { user: JwtPayload }) {
    return this.linkIndexService.getOutgoingLinks(filePath, req.user.email);
  }

  @Get('unlinked-mentions')
  @RequiredScope('links:read')
  async getUnlinkedMentions(@Query('path') filePath: string, @Req() req: { user: JwtPayload }) {
    return this.linkIndexService.getUnlinkedMentions(filePath, req.user.email);
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
