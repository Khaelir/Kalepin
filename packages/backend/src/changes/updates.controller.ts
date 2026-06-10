import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { User, StarredItem } from '../entities';
import { ChangeTrackingService } from './change-tracking.service';

@Controller('api/updates')
@UseGuards(CombinedAuthGuard)
export class UpdatesController {
  constructor(
    private readonly changeTracking: ChangeTrackingService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(StarredItem) private readonly starRepo: Repository<StarredItem>,
  ) {}

  @Get()
  @RequiredScope('updates:read')
  async getUpdates(
    @Req() req: { user: JwtPayload },
    @Query('since') sinceParam?: string,
  ) {
    const user = await this.userRepo.findOneBy({ id: req.user.sub });

    // Determine the "since" cutoff
    let since: Date | null = null;
    if (sinceParam) {
      since = new Date(sinceParam);
    } else if (user?.lastActiveAt) {
      since = new Date(user.lastActiveAt);
    }

    // Load starred items to split response
    const stars = await this.starRepo.find({ where: { userId: req.user.sub } });
    const starredRefs = stars.map((s) => ({ type: s.type, path: s.path }));

    // Exclude current user's own changes, split by starred, gate by visibility.
    return this.changeTracking.getChangesSince(since, req.user.sub, starredRefs, req.user.email);
  }

  @Get('recently-edited')
  @RequiredScope('updates:read')
  async getRecentlyEdited(
    @Req() req: { user: JwtPayload },
    @Query('limit') limitParam?: string,
  ) {
    const parsed = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 500)) : 200;
    return this.changeTracking.getRecentlyEdited(limit, req.user.email);
  }

  @Post('mark-seen')
  @RequiredScope('updates:read')
  async markSeen(@Req() req: { user: JwtPayload }) {
    const user = await this.userRepo.findOneBy({ id: req.user.sub });
    if (user) {
      user.lastActiveAt = new Date();
      await this.userRepo.save(user);
    }
    return { ok: true };
  }
}
