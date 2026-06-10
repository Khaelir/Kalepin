import { Controller, Post, Get, Delete, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { RequiredScope } from '../auth/required-scope.decorator';
import { McpService } from './mcp.service';
import { hashToken } from '../auth/oauth/oauth-tokens';

@Controller('mcp')
@UseGuards(CombinedAuthGuard)
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Post()
  @RequiredScope('notes:read')
  async handlePost(@Req() req: Request, @Res() res: Response) {
    await this.mcpService.handleRequest(req, res, req.body, this.buildUser(req));
  }

  @Get()
  @RequiredScope('notes:read')
  async handleGet(@Req() req: Request, @Res() res: Response) {
    await this.mcpService.handleSseRequest(req, res, this.buildUser(req));
  }

  @Delete()
  @RequiredScope('notes:read')
  async handleDelete(@Req() req: Request, @Res() res: Response) {
    await this.mcpService.handleDeleteSession(req, res, this.buildUser(req));
  }

  // Stitch the access-token hash onto originCredential so OAuth-side revocation
  // can match in-flight MCP sessions deterministically (task 8.6).
  private buildUser(req: Request): {
    sub: number;
    email: string;
    scope?: any;
    apiKeyId?: number;
    grantId?: number;
    originCredential?: any;
    pinUnlockHeader?: string;
  } {
    const user = (req as any).user;
    let originCredential = (req as any).originCredential;
    if (originCredential?.type === 'oauth') {
      const auth = req.headers['authorization'] as string | undefined;
      const raw = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
      originCredential = {
        ...originCredential,
        accessTokenHash: raw ? hashToken(raw) : '',
      };
    }
    const unlockHeaderRaw = req.headers['x-kalepin-unlock'];
    const pinUnlockHeader = typeof unlockHeaderRaw === 'string'
      ? unlockHeaderRaw
      : Array.isArray(unlockHeaderRaw)
        ? unlockHeaderRaw[0]
        : undefined;
    return {
      sub: user.sub,
      email: user.email,
      scope: user.scope,
      apiKeyId: user.apiKeyId,
      grantId: user.grantId,
      originCredential,
      pinUnlockHeader,
    };
  }
}
