import { Controller, Post, Get, Put, Delete, Body, Query, Param, Res, UseGuards, Req, NotFoundException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CombinedAuthGuard } from './combined-auth.guard';
import { RequiredScope } from './required-scope.decorator';
import { SCOPE_PERMISSIONS, PERMISSIONS } from './permissions';
import type { ApiKeyScope } from './permissions';
import { isAdmin } from './admin.util';
import { canonicalizeEmail } from './email';
import { safeReturnPath } from './return-to';
import { SlidingWindowRateLimiter } from './oauth/rate-limit';
import { User } from '../entities/user.entity';

@Controller('api')
export class AuthController {
  // Brute-force / email-bombing protection on the magic-link send path.
  // Two windows: one per requesting IP (covers spray-and-pray scanners) and
  // one per target email (covers bombing a single inbox from rotated IPs).
  private readonly magicLinkIpLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 10 });
  private readonly magicLinkEmailLimiter = new SlidingWindowRateLimiter({ windowMs: 60 * 60_000, max: 5 });

  constructor(
    private readonly authService: AuthService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  @Post('auth/magic-link')
  async requestMagicLink(@Body('email') email: string, @Body('returnTo') returnTo: string | undefined, @Req() req: Request) {
    const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown') as string;
    const ipCheck = this.magicLinkIpLimiter.check(ip);
    if (!ipCheck.allowed) {
      throw new HttpException(
        { message: 'Too many requests', retryAfterSec: ipCheck.retryAfterSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (typeof email === 'string' && email.length > 0 && email.length < 320) {
      const canonical = canonicalizeEmail(email);
      const emailCheck = this.magicLinkEmailLimiter.check(canonical);
      if (!emailCheck.allowed) {
        throw new HttpException(
          { message: 'Too many requests', retryAfterSec: emailCheck.retryAfterSec },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    await this.authService.requestMagicLink(email, returnTo);
    return { message: 'Magic link sent' };
  }

  @Get('auth/verify')
  async verifyMagicLink(@Query('token') token: string, @Res() res: Response) {
    const { sessionToken, returnTo } = await this.authService.verifyMagicLink(token);
    // Re-checked here as well as on storage: rows written before the check
    // existed may still hold an off-origin target.
    res.redirect(`${safeReturnPath(returnTo)}?token=${sessionToken}`);
  }

  @Post('auth/api-keys')
  @UseGuards(JwtAuthGuard)
  async createApiKey(@Body() body: { name: string; scope?: string }, @Req() req: any) {
    const scope = (['ro', 'rc', 'rw', 'admin'].includes(body.scope!) ? body.scope : 'rw') as ApiKeyScope;
    if (scope === 'admin' && !isAdmin(req.user.email)) {
      throw new ForbiddenException('Only admins can create admin-scoped keys');
    }
    return this.authService.createApiKey(req.user.sub, body.name, scope);
  }

  @Get('auth/api-keys')
  @UseGuards(JwtAuthGuard)
  async listApiKeys(@Req() req: any) {
    return this.authService.listApiKeys(req.user.sub);
  }

  @Delete('auth/api-keys/:id')
  @UseGuards(JwtAuthGuard)
  async revokeApiKey(@Param('id') id: string, @Req() req: any) {
    const deleted = await this.authService.revokeApiKey(req.user.sub, parseInt(id, 10));
    if (!deleted) {
      throw new NotFoundException('API key not found');
    }
    return { deleted: true };
  }

  @Get('auth/api-keys/whoami')
  @UseGuards(CombinedAuthGuard)
  async whoami(@Req() req: any) {
    const scope: ApiKeyScope = req.user.scope ?? 'rw';
    return { scope, permissions: [...SCOPE_PERMISSIONS[scope]], isAdmin: isAdmin(req.user.email) };
  }

  @Get('users')
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('users:read')
  async listUsers() {
    const users = await this.userRepo.find({ order: { email: 'ASC' } });
    return users.map((u) => ({
      email: u.email,
      displayName: u.displayName || null,
    }));
  }

  @Get('users/me/tours')
  @UseGuards(JwtAuthGuard)
  async getCompletedTours(@Req() req: any) {
    const user = await this.userRepo.findOneBy({ id: req.user.sub });
    return user?.completedTours ?? [];
  }

  @Put('users/me/tours')
  @UseGuards(JwtAuthGuard)
  async updateCompletedTour(@Body() body: { tourId: string; version: number }, @Req() req: any) {
    const user = await this.userRepo.findOneBy({ id: req.user.sub });
    if (!user) throw new NotFoundException('User not found');

    const tours = user.completedTours ?? [];
    const idx = tours.findIndex((t) => t.tourId === body.tourId);
    if (idx >= 0) {
      tours[idx].version = body.version;
    } else {
      tours.push({ tourId: body.tourId, version: body.version });
    }
    user.completedTours = tours;
    await this.userRepo.save(user);
    return tours;
  }
}
