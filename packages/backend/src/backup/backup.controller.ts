import { Controller, Get, Post, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { CombinedAuthGuard } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { BackupService } from './backup.service';

@Controller('api/admin/backup')
@UseGuards(CombinedAuthGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post()
  @RequiredScope('admin:backup')
  async triggerBackup() {
    if (this.backupService.isBackupInProgress) {
      throw new HttpException('Backup already in progress', HttpStatus.CONFLICT);
    }
    return this.backupService.runBackup();
  }

  @Get()
  @RequiredScope('admin:backup')
  async listBackups() {
    return this.backupService.listBackups();
  }
}
