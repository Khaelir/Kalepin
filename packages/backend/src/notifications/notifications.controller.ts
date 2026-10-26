import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiredScope } from '../auth/required-scope.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { PinService } from '../pin/pin.service';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationPreferencesService, isEmailPreference } from './notification-preferences.service';

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Every route is scoped to `req.user.email`: an item id that is not the
 * caller's own resolves to 404, never to another user's data. */
@Controller('api/notifications')
export class NotificationsController {
  constructor(
    private readonly inbox: NotificationInboxService,
    private readonly preferences: NotificationPreferencesService,
    private readonly pinService: PinService,
  ) {}

  @Get()
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('updates:read')
  async list(
    @Req() req: { user: JwtPayload; headers: { cookie?: string; 'x-kalepin-unlock'?: string | string[] } },
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const page = await this.inbox.list(req.user.email, {
      limit: parsePositiveInt(limit),
      before: parsePositiveInt(before),
    });
    // Snippets quote the note body or its comments: a PIN-locked note keeps
    // its item but loses the snippet unless this request carries its unlock
    // credential. Same rule as GET /api/files/search.
    const unlocked = new Map<string, boolean>();
    for (const item of page.items) {
      if (item.snippet == null) continue;
      if (!unlocked.has(item.path)) {
        unlocked.set(item.path, await this.pinService.isUnlockedForRequest(req, item.path, req.user.email));
      }
      if (!unlocked.get(item.path)) item.snippet = null;
    }
    return page;
  }

  @Get('unread-count')
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('updates:read')
  async unreadCount(@Req() req: { user: JwtPayload }) {
    return { count: await this.inbox.unreadCount(req.user.email) };
  }

  @Post('read-all')
  @HttpCode(200)
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('updates:read')
  async markAllRead(@Req() req: { user: JwtPayload }) {
    return { updated: await this.inbox.markAllRead(req.user.email) };
  }

  @Post(':id/read')
  @HttpCode(200)
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('updates:read')
  async markRead(@Param('id') idStr: string, @Req() req: { user: JwtPayload }) {
    const id = parsePositiveInt(idStr);
    if (id === undefined) throw new NotFoundException();
    await this.inbox.markRead(req.user.email, id);
    return { ok: true };
  }

  // Account setting: browser session only (like users/me/tours), so an API
  // key or OAuth token cannot change where its owner's email goes.
  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  async getPreferences(@Req() req: { user: JwtPayload }) {
    return { email: await this.preferences.get(req.user.email) };
  }

  @Put('preferences')
  @UseGuards(JwtAuthGuard)
  async setPreferences(@Body() body: { email?: unknown }, @Req() req: { user: JwtPayload }) {
    const pref = body?.email;
    if (!isEmailPreference(pref)) {
      throw new BadRequestException("email must be 'all', 'mentions' or 'none'");
    }
    await this.preferences.set(req.user.email, pref);
    return { email: pref };
  }
}
