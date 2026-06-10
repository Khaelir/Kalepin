import { Controller, Get, UseGuards } from '@nestjs/common';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { RequiredScope } from '../auth/required-scope.decorator';
import { StatsService } from './stats.service';

@Controller('api/admin/stats')
@UseGuards(CombinedAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  @RequiredScope('admin:stats')
  getOverview() {
    return this.statsService.getOverview();
  }

  @Get('mcp-tools')
  @RequiredScope('admin:stats')
  getMcpTools() {
    return this.statsService.getMcpTools();
  }

  @Get('users')
  @RequiredScope('admin:stats')
  getUsers() {
    return this.statsService.getUsers();
  }
}
