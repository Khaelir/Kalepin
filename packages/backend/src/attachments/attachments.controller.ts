import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { RequiredScope } from '../auth/required-scope.decorator';
import { AttachmentsService } from './attachments.service';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

@Controller('api/files')
@UseGuards(CombinedAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('upload')
  @RequiredScope('attachments:write')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('docPath') docPath: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new PayloadTooLargeException('File exceeds 50MB size limit');
    }
    return this.attachmentsService.upload(file, docPath, req.user?.email?.toLowerCase());
  }

  @Get('attachment')
  @RequiredScope('attachments:read')
  async serve(
    @Query('name') name: string,
    @Query('doc') doc: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (!name) {
      throw new BadRequestException('Missing attachment name');
    }
    const requesterEmail = req.user?.email?.toLowerCase();
    const { buffer, contentType } = await this.attachmentsService.serve(name, doc, requesterEmail);
    res.set('Content-Type', contentType);
    res.send(buffer);
  }

  @Post('attachments/cleanup')
  @RequiredScope('attachments:write')
  async cleanup() {
    return this.attachmentsService.cleanup();
  }
}
