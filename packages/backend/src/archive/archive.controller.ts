import {
  Controller,
  Get,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';
import { diskStorage } from 'multer';
import { CombinedAuthGuard } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { ArchiveService } from './archive.service';

@Controller('api/admin/backup')
@UseGuards(CombinedAuthGuard)
export class ArchiveController {
  private readonly logger = new Logger(ArchiveController.name);

  constructor(private readonly archiveService: ArchiveService) {}

  @Get('download')
  @RequiredScope('admin:backup')
  async download(@Res() res: Response) {
    let tmpDir: string | undefined;
    try {
      const result = await this.archiveService.createArchive();
      tmpDir = result.tmpDir;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `kalepin-backup-${timestamp}.tar.gz`;

      res.set({
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename=${filename}`,
      });

      const stream = fs.createReadStream(result.archivePath);
      stream.pipe(res);

      const cleanup = () => {
        if (tmpDir) {
          fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          tmpDir = undefined;
        }
      };
      res.on('finish', cleanup);
      res.on('close', cleanup);
    } catch (err) {
      if (tmpDir) {
        fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
      throw err;
    }
  }

  @Post('restore')
  @RequiredScope('admin:backup')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_req, _file, cb) => cb(null, `kalepin-restore-${Date.now()}.tar.gz`),
      }),
    }),
  )
  async restore(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Extract to a temp dir for validation
    const validationDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kalepin-validate-'));
    try {
      await tar.extract({ file: file.path, cwd: validationDir });

      // Validate archive structure
      const hasVault = await fs.promises
        .stat(path.join(validationDir, 'vault'))
        .then((s) => s.isDirectory())
        .catch(() => false);
      const hasDb = await fs.promises
        .stat(path.join(validationDir, 'kalepin.sqlite'))
        .then((s) => s.isFile())
        .catch(() => false);

      if (!hasVault || !hasDb) {
        throw new BadRequestException(
          'Invalid archive: must contain a vault/ directory and kalepin.sqlite at the root',
        );
      }
    } catch (err) {
      // Clean up validation dir and uploaded file
      await fs.promises.rm(validationDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.unlink(file.path).catch(() => {});
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Failed to extract archive: invalid or corrupted .tar.gz');
    }

    // Clean up validation dir
    await fs.promises.rm(validationDir, { recursive: true, force: true }).catch(() => {});

    // Perform restore
    try {
      await this.archiveService.restoreFromArchive(file.path);
    } catch (err) {
      await fs.promises.unlink(file.path).catch(() => {});
      this.logger.error('Restore failed', err);
      throw new InternalServerErrorException('Restore failed');
    }

    // Clean up uploaded file
    await fs.promises.unlink(file.path).catch(() => {});

    // Respond then exit
    setTimeout(() => process.exit(0), 500);
    return { message: 'Restore complete, restarting...' };
  }
}
