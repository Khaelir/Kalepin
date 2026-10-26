import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { PinService } from '../pin';
import { RelatedNotesService, RelatedNotesResult } from './related-notes.service';
import { clampRelatedLimit } from './related-notes';

@Controller('api/search')
@UseGuards(CombinedAuthGuard)
export class RelatedNotesController {
  constructor(
    private readonly relatedNotes: RelatedNotesService,
    private readonly visibility: GrantAwareVisibility,
    private readonly pinService: PinService,
  ) {}

  @Get('related')
  @RequiredScope('notes:search')
  async related(
    @Query('path') notePath: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: Request & { user: JwtPayload },
  ): Promise<RelatedNotesResult> {
    if (!notePath) {
      throw new BadRequestException('Missing query parameter "path"');
    }
    // Visibility first so a PIN on a foreign note is never observable; then
    // the PIN, since the list describes what the note is about.
    await this.visibility.assertReadableBy(notePath, req.user.email);
    await this.pinService.assertUnlockedForRequest(req, notePath, req.user.email);
    return this.relatedNotes.findRelated(notePath, {
      limit: clampRelatedLimit(limit),
      userEmail: req.user.email,
    });
  }
}
