import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { RequiredScope } from '../auth/required-scope.decorator';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { CommentsService } from './comments.service';
import { PinService } from '../pin';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import { AccessLogService } from '../access-log/access-log.service';
import { extractClientIp } from '../access-log/extract-ip';

@Controller('api/comments')
@UseGuards(CombinedAuthGuard)
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly pinService: PinService,
    private readonly visibility: GrantAwareVisibility,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates,
    private readonly accessLog: AccessLogService,
  ) {}

  private assertNotE2E(path: string): void {
    if (this.predicates.commentBodiesEncrypted(path)) {
      throw new ForbiddenException('e2e-no-comments');
    }
  }

  @Get()
  @RequiredScope('comments:read')
  async getComments(@Query('path') filePath: string, @Req() req: Request & { user: any }) {
    this.assertNotE2E(filePath);
    await this.visibility.assertReadableBy(filePath, req.user.email.toLowerCase());
    await this.pinService.assertUnlockedForRequest(req, filePath, req.user.email.toLowerCase());
    return this.commentsService.getComments(filePath);
  }

  @Post()
  @RequiredScope('comments:write')
  async addComment(
    @Body() body: { path: string; blockId: string; text: string; quotedText?: string; positionHint?: { from: number; to: number } },
    @Req() req: Request & { user: any },
  ) {
    this.assertNotE2E(body.path);
    await this.visibility.assertCommentableBy(body.path, req.user.email.toLowerCase());
    await this.pinService.assertUnlockedForRequest(req, body.path, req.user.email.toLowerCase());
    const result = await this.commentsService.addComment(body.path, body.blockId, req.user.email, body.text, body.quotedText, body.positionHint);
    void this.accessLog.record(body.path, req.user.email.toLowerCase(), 'comment', extractClientIp(req));
    return result;
  }

  @Post('reply')
  @RequiredScope('comments:write')
  async reply(
    @Body() body: { path: string; blockId: string; threadId: string; text: string },
    @Req() req: Request & { user: any },
  ) {
    this.assertNotE2E(body.path);
    await this.visibility.assertCommentableBy(body.path, req.user.email.toLowerCase());
    await this.pinService.assertUnlockedForRequest(req, body.path, req.user.email.toLowerCase());
    return this.commentsService.replyToThread(
      body.path, body.blockId, body.threadId, req.user.email, body.text,
    );
  }

  @Post('resolve')
  @RequiredScope('comments:write')
  async resolve(
    @Body() body: { path: string; blockId: string; threadId: string; resolved: boolean },
    @Req() req: any,
  ) {
    this.assertNotE2E(body.path);
    await this.visibility.assertCommentableBy(body.path, req.user.email.toLowerCase());
    await this.commentsService.resolveThread(body.path, body.blockId, body.threadId, body.resolved);
    return { ok: true };
  }

  @Delete()
  @RequiredScope('comments:write')
  async deleteComment(
    @Query('path') filePath: string,
    @Query('blockId') blockId: string,
    @Query('threadId') threadId: string,
    @Query('commentId') commentId: string,
    @Req() req: any,
  ) {
    this.assertNotE2E(filePath);
    await this.visibility.assertCommentableBy(filePath, req.user.email.toLowerCase());
    const deleted = await this.commentsService.deleteComment(
      filePath, blockId, threadId, commentId, req.user.email,
    );
    return { deleted };
  }
}
