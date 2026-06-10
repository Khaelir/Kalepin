import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { OAuthService } from './oauth.service';

// Authenticated JSON API consumed by the SPA consent page. Lives under `/api`
// so it inherits same-origin CORS rules — only the user's logged-in browser
// session reaches these. The `request_id` (32 random bytes, server-issued,
// single-use) doubles as the CSRF token; see design.md Decision 21.
@Controller('api/oauth')
@UseGuards(JwtAuthGuard)
export class OAuthConsentController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('authorize/:request_id')
  async getRequest(@Param('request_id') requestId: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.oauth.getAuthorizationRequest(requestId, user.sub);
  }

  @Post('authorize/:request_id/approve')
  async approve(
    @Param('request_id') requestId: string,
    @Body() body: { granted_scope?: string[] },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    if (process.env.OAUTH_CONSENT_DISABLED === '1') {
      throw new GoneException('OAuth consent disabled');
    }
    const result = await this.oauth.approveAuthorization(requestId, user.sub, body.granted_scope);
    return { redirect_to: result.redirect_to };
  }

  @Post('authorize/:request_id/deny')
  async deny(@Param('request_id') requestId: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.oauth.denyAuthorization(requestId, user.sub);
  }

  @Get('grants')
  async listGrants(@Req() req: Request) {
    const user = (req as any).user;
    return this.oauth.listGrantsForUser(user.sub);
  }

  @Delete('grants/:id')
  async revokeGrant(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    const ok = await this.oauth.revokeGrantForUser(user.sub, parseInt(id, 10));
    if (!ok) throw new NotFoundException('Grant not found');
    return { revoked: true };
  }
}
