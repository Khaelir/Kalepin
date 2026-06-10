import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { StarsService } from './stars.service';

@Controller('api/stars')
@UseGuards(CombinedAuthGuard)
export class StarsController {
  constructor(private readonly starsService: StarsService) {}

  @Get()
  @RequiredScope('stars:read')
  async list(@Req() req: { user: JwtPayload }) {
    return this.starsService.listByUser(req.user.sub);
  }

  @Post()
  @RequiredScope('stars:write')
  async add(
    @Req() req: { user: JwtPayload },
    @Body() body: { type: 'file' | 'folder'; path: string },
  ) {
    return this.starsService.addStar(req.user.sub, body.type, body.path);
  }

  @Delete(':id')
  @RequiredScope('stars:write')
  async remove(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
  ) {
    await this.starsService.removeStar(Number(id), req.user.sub);
    return { ok: true };
  }
}
