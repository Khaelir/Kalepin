import { Body, Controller, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { FilesService } from './files.service';
import { TemplatesService } from '../templates/templates.service';

interface CreateItemBody {
  kind: 'note' | 'folder';
  parent_path: string;
  name?: string;
  /** Template path or listed template name (notes only). */
  template?: string;
  /** IANA timezone for template dates. */
  timezone?: string;
}

@Controller('api/vault')
@UseGuards(CombinedAuthGuard)
export class VaultController {
  constructor(
    private readonly filesService: FilesService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // Resolved lazily: TemplatesModule imports FilesModule, so a static
  // dependency here would be a module cycle.
  private getTemplatesService(): TemplatesService {
    return this.moduleRef.get(TemplatesService, { strict: false });
  }

  @Post('items')
  @RequiredScope('notes:create')
  async createItem(@Body() body: CreateItemBody, @Req() req: Request & { user: JwtPayload }) {
    if (body.kind !== 'note' && body.kind !== 'folder') {
      throw new BadRequestException('kind must be "note" or "folder"');
    }
    if (typeof body.parent_path !== 'string') {
      throw new BadRequestException('parent_path is required');
    }
    if (body.template !== undefined && body.template !== null && body.template !== '') {
      if (body.kind !== 'note') throw new BadRequestException('template is only supported for notes');
      if (typeof body.template !== 'string') throw new BadRequestException('template must be a string');
      return this.getTemplatesService().createFromTemplate(
        {
          parentPath: body.parent_path,
          name: body.name,
          template: body.template,
          timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
        },
        { email: req.user.email, userId: req.user.sub, unlock: req },
      );
    }
    return this.filesService.createItem(body.kind, body.parent_path, body.name, req.user.sub, req.user.email);
  }
}
