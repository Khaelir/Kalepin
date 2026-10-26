import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { TemplateActor, TemplatesService } from './templates.service';

type AuthedRequest = Request & { user: JwtPayload };

/** The request doubles as the PIN carrier: unlock cookie + one-shot header. */
export function templateActorFrom(req: AuthedRequest): TemplateActor {
  return { email: req.user.email, userId: req.user.sub, unlock: req };
}

@Controller('api/templates')
@UseGuards(CombinedAuthGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequiredScope('notes:read')
  async list(@Req() req: AuthedRequest) {
    return this.templates.listTemplates(req.user.email);
  }

  @Post('sample')
  @RequiredScope('notes:create')
  async createSample(@Req() req: AuthedRequest) {
    return this.templates.createSampleTemplate(templateActorFrom(req));
  }
}

@Controller('api/daily-notes')
@UseGuards(CombinedAuthGuard)
export class DailyNotesController {
  constructor(private readonly templates: TemplatesService) {}

  @Post()
  @RequiredScope('notes:create')
  async open(
    @Body() body: { date?: string; timezone?: string },
    @Req() req: AuthedRequest,
  ) {
    return this.templates.dailyNote(
      { date: body?.date ?? '', timezone: typeof body?.timezone === 'string' ? body.timezone : undefined },
      templateActorFrom(req),
    );
  }
}
