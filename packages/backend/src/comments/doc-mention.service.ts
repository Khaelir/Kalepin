import { Injectable, Logger } from '@nestjs/common';
import { extractDocMentions, extractDocMentionsWithLines } from './extract-doc-mentions';
import { findNearestHeading } from './find-nearest-heading';
import { MentionTrackingService } from './mention-tracking.service';
import { NotificationService } from './notification.service';
import { StarsService } from '../stars/stars.service';

@Injectable()
export class DocMentionService {
  private readonly logger = new Logger(DocMentionService.name);

  constructor(
    private readonly mentionTracking: MentionTrackingService,
    private readonly notificationService: NotificationService,
    private readonly starsService: StarsService,
  ) {}

  /**
   * Detect new mentions by diffing old and new content, then trigger
   * the notification pipeline for each newly added mention.
   */
  async processDocSave(
    docPath: string,
    oldContent: string,
    newContent: string,
    authorUserId: number,
  ): Promise<void> {
    const oldMentions = extractDocMentions(oldContent);
    const newMentionsWithLines = extractDocMentionsWithLines(newContent);

    // Only process mentions that are new (not in old content)
    const newOnly = newMentionsWithLines.filter((m) => !oldMentions.has(m.email));
    if (newOnly.length === 0) return;

    // Resolve author email for notifications
    const authorEmail = await this.notificationService.resolveUserEmail(authorUserId);
    if (!authorEmail) {
      this.logger.warn(`Could not resolve email for userId=${authorUserId}, skipping doc mention notifications`);
      return;
    }

    for (const mention of newOnly) {
      const mentionedUserId = await this.notificationService.resolveUserId(mention.email);
      if (!mentionedUserId) continue;

      // Auto-star regardless of notification approval
      await this.starsService.autoStarForUser(mentionedUserId, docPath).catch((err) => {
        this.logger.error(`Failed to auto-star ${docPath} for user ${mentionedUserId}`, err);
      });

      const approved = await this.mentionTracking.shouldSend(
        mentionedUserId,
        authorUserId,
        'doc',
        docPath,
      );
      if (!approved) continue;

      const headingSlug = findNearestHeading(newContent, mention.line);

      await this.notificationService.notifyDocMention(
        mention.email,
        authorEmail,
        docPath,
        headingSlug,
      );

      await this.mentionTracking.recordSent(mentionedUserId, 'doc', docPath);
    }
  }
}
