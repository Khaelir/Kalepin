import { Controller, Get, Post, Delete, Param, Req, UseGuards } from '@nestjs/common';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { TrashService } from './trash.service';
import { trashRetentionDays } from './trash-retention.service';

@Controller('api/trash')
@UseGuards(CombinedAuthGuard)
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  /** Shared-zone items plus the caller's own personal items. */
  @Get()
  @RequiredScope('notes:read')
  async list(@Req() req: { user: JwtPayload }) {
    return {
      retentionDays: trashRetentionDays(),
      items: await this.trash.list(req.user.email),
    };
  }

  @Post(':id/restore')
  @RequiredScope('notes:delete')
  async restore(@Param('id') id: string, @Req() req: { user: JwtPayload }) {
    return this.trash.restore(id, { userId: req.user.sub, email: req.user.email });
  }

  @Delete(':id')
  @RequiredScope('notes:delete')
  async purge(@Param('id') id: string, @Req() req: { user: JwtPayload }) {
    await this.trash.purge(id, req.user.email);
    return { purged: id };
  }

  /** Purges every item the caller may purge; others' items stay. */
  @Delete()
  @RequiredScope('notes:delete')
  async empty(@Req() req: { user: JwtPayload }) {
    return { purged: await this.trash.emptyTrash(req.user.email) };
  }
}
