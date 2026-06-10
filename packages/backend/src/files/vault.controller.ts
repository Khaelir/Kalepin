import { Body, Controller, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { FilesService } from './files.service';

interface CreateItemBody {
  kind: 'note' | 'folder';
  parent_path: string;
  name?: string;
}

@Controller('api/vault')
@UseGuards(CombinedAuthGuard)
export class VaultController {
  constructor(private readonly filesService: FilesService) {}

  @Post('items')
  @RequiredScope('notes:create')
  async createItem(@Body() body: CreateItemBody, @Req() req: { user: JwtPayload }) {
    if (body.kind !== 'note' && body.kind !== 'folder') {
      throw new BadRequestException('kind must be "note" or "folder"');
    }
    if (typeof body.parent_path !== 'string') {
      throw new BadRequestException('parent_path is required');
    }
    return this.filesService.createItem(body.kind, body.parent_path, body.name, req.user.sub, req.user.email);
  }
}
