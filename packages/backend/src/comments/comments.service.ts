import { Injectable, Inject, forwardRef, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SidecarService } from './sidecar.service';
import { SearchService } from '../search/search.service';
import { DailyStatsService } from '../stats/daily-stats.service';
import { NotificationService } from './notification.service';
import { MentionTrackingService } from './mention-tracking.service';
import { StarsService } from '../stars/stars.service';
import { NotificationInboxService, RecordInput } from '../notifications/notification-inbox.service';
import { extractMentions } from './extract-mentions';
import { CommentThread, Comment, SidecarData } from '@kalepin/shared';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly sidecar: SidecarService,
    @Inject(forwardRef(() => SearchService))
    private readonly searchService: SearchService,
    private readonly dailyStatsService: DailyStatsService,
    private readonly notificationService: NotificationService,
    private readonly mentionTracking: MentionTrackingService,
    private readonly starsService: StarsService,
    @Optional() private readonly inbox?: NotificationInboxService,
  ) {}

  private findThread(
    data: SidecarData,
    blockId: string,
    threadId: string,
  ): { block: { threads: CommentThread[] }; blockId: string; thread: CommentThread } {
    // Fast path: direct blockId lookup
    const block = data.comments[blockId];
    if (block) {
      const thread = block.threads.find((t) => t.id === threadId);
      if (thread) return { block, blockId, thread };
    }
    // Fallback: scan all blocks (threadIds are UUIDs, globally unique)
    for (const [actualBlockId, b] of Object.entries(data.comments)) {
      const thread = b.threads.find((t) => t.id === threadId);
      if (thread) return { block: b, blockId: actualBlockId, thread };
    }
    throw new Error('Thread not found');
  }

  async addComment(
    filePath: string,
    blockId: string,
    author: string,
    text: string,
    quotedText?: string,
    positionHint?: { from: number; to: number },
  ): Promise<{ thread: CommentThread; comment: Comment }> {
    const data = await this.sidecar.read(filePath);

    if (!data.comments[blockId]) {
      data.comments[blockId] = { threads: [] };
    }

    const comment: Comment = {
      id: randomUUID(),
      author,
      text,
      createdAt: new Date().toISOString(),
    };

    const thread: CommentThread = {
      id: randomUUID(),
      blockId,
      quotedText,
      positionHint,
      comments: [comment],
      resolved: false,
    };

    data.comments[blockId].threads.push(thread);
    await this.sidecar.write(filePath, data);

    await this.searchService.indexNoteComments(filePath);
    this.searchService.indexCommentEmbeddings(filePath).catch((err) => {
      this.logger.error(`Failed to index comment embeddings for ${filePath}`, err);
    });

    this.dailyStatsService.trackCommentAdded();
    this.sendMentionNotifications(text, author, filePath, thread.id, comment.id);

    return { thread, comment };
  }

  /**
   * Append a comment posted by an unverified guest (someone resolving a share
   * link with `allow_guest_comments=true`). The fields differ from
   * `addComment`: `authorVerified=false` and `authorName` is the display name
   * the guest typed. Mention notifications are intentionally skipped — guests
   * can type anything in the email field, so honoring `@user` would let them
   * trigger arbitrary outbound emails by pretending to be the recipient.
   */
  async addGuestComment(
    filePath: string,
    blockId: string,
    authorEmail: string,
    authorName: string,
    text: string,
    quotedText?: string,
    positionHint?: { from: number; to: number },
  ): Promise<{ thread: CommentThread; comment: Comment }> {
    const data = await this.sidecar.read(filePath);
    if (!data.comments[blockId]) {
      data.comments[blockId] = { threads: [] };
    }
    const comment: Comment = {
      id: randomUUID(),
      author: authorEmail,
      authorName,
      authorVerified: false,
      text,
      createdAt: new Date().toISOString(),
    };
    const thread: CommentThread = {
      id: randomUUID(),
      blockId,
      quotedText,
      positionHint,
      comments: [comment],
      resolved: false,
    };
    data.comments[blockId].threads.push(thread);
    await this.sidecar.write(filePath, data);

    await this.searchService.indexNoteComments(filePath);
    this.searchService.indexCommentEmbeddings(filePath).catch((err) => {
      this.logger.error(`Failed to index comment embeddings for ${filePath}`, err);
    });

    this.dailyStatsService.trackCommentAdded();
    // No sendMentionNotifications: see method docstring.
    return { thread, comment };
  }

  /** Guest-mode reply. Same caveats as `addGuestComment`: unverified author,
   * mention notifications suppressed. */
  async replyToGuestThread(
    filePath: string,
    blockId: string,
    threadId: string,
    authorEmail: string,
    authorName: string,
    text: string,
  ): Promise<Comment> {
    const data = await this.sidecar.read(filePath);
    const { thread } = this.findThread(data, blockId, threadId);
    const comment: Comment = {
      id: randomUUID(),
      author: authorEmail,
      authorName,
      authorVerified: false,
      text,
      createdAt: new Date().toISOString(),
    };
    thread.comments.push(comment);
    await this.sidecar.write(filePath, data);
    await this.searchService.indexNoteComments(filePath);
    this.searchService.indexCommentEmbeddings(filePath).catch((err) => {
      this.logger.error(`Failed to index comment embeddings for ${filePath}`, err);
    });
    this.dailyStatsService.trackCommentAdded();
    return comment;
  }

  async replyToThread(
    filePath: string,
    blockId: string,
    threadId: string,
    author: string,
    text: string,
  ): Promise<Comment> {
    const data = await this.sidecar.read(filePath);
    const { thread } = this.findThread(data, blockId, threadId);

    const comment: Comment = {
      id: randomUUID(),
      author,
      text,
      createdAt: new Date().toISOString(),
    };

    thread.comments.push(comment);
    await this.sidecar.write(filePath, data);

    await this.searchService.indexNoteComments(filePath);
    this.searchService.indexCommentEmbeddings(filePath).catch((err) => {
      this.logger.error(`Failed to index comment embeddings for ${filePath}`, err);
    });

    this.dailyStatsService.trackCommentAdded();
    // Reply-chain: notify all thread participants + new mentions
    this.sendReplyChainNotifications(thread, author, filePath, threadId, comment);

    return comment;
  }

  async resolveThread(
    filePath: string,
    blockId: string,
    threadId: string,
    resolved: boolean,
  ): Promise<void> {
    const data = await this.sidecar.read(filePath);
    const { thread } = this.findThread(data, blockId, threadId);

    thread.resolved = resolved;
    await this.sidecar.write(filePath, data);
    if (resolved) this.dailyStatsService.trackCommentResolved();
  }

  async deleteComment(
    filePath: string,
    blockId: string,
    threadId: string,
    commentId: string,
    author: string,
  ): Promise<boolean> {
    const data = await this.sidecar.read(filePath);
    let match: ReturnType<typeof this.findThread>;
    try {
      match = this.findThread(data, blockId, threadId);
    } catch {
      return false;
    }

    const idx = match.thread.comments.findIndex((c) => c.id === commentId && c.author === author);
    if (idx === -1) return false;

    match.thread.comments.splice(idx, 1);

    // Remove empty thread
    if (match.thread.comments.length === 0) {
      match.block.threads = match.block.threads.filter((t) => t.id !== threadId);
    }

    // Remove empty block
    if (match.block.threads.length === 0) {
      delete data.comments[match.blockId];
    }

    await this.sidecar.write(filePath, data);

    await this.searchService.indexNoteComments(filePath);
    await this.searchService.indexCommentEmbeddings(filePath);

    return true;
  }

  async getComments(filePath: string) {
    return this.sidecar.getThreadsForDocument(filePath);
  }

  private sendMentionNotifications(
    text: string,
    author: string,
    filePath: string,
    threadId: string,
    commentId: string,
  ): void {
    const mentions = extractMentions(text);
    for (const email of mentions) {
      if (email === author) continue;

      this.processMentionNotification(email, author, filePath, threadId, commentId, text).catch((err) => {
        this.logger.error(`Failed to process mention notification for ${email}`, err);
      });
    }
  }

  private async processMentionNotification(
    mentionedEmail: string,
    authorEmail: string,
    filePath: string,
    threadId: string,
    commentId: string,
    text: string,
  ): Promise<void> {
    const mentionedUserId = await this.notificationService.resolveUserId(mentionedEmail);
    if (!mentionedUserId) return;

    const authorUserId = await this.notificationService.resolveUserId(authorEmail);
    if (!authorUserId) return;

    // Auto-star
    await this.starsService.autoStarForUser(mentionedUserId, filePath).catch((err) => {
      this.logger.error(`Failed to auto-star ${filePath} for user ${mentionedUserId}`, err);
    });

    await this.recordInboxItem({
      type: 'comment_mention',
      recipientEmail: mentionedEmail,
      actorEmail: authorEmail,
      path: filePath,
      threadId,
      commentId,
      snippet: text,
    });

    const approved = await this.mentionTracking.shouldSend(
      mentionedUserId,
      authorUserId,
      'comment',
      filePath,
      threadId,
      commentId,
    );
    if (!approved) return;

    await this.notificationService.notifyMention({
      mentionedEmail,
      authorEmail,
      commentText: '',
      notePath: filePath,
      threadId,
    });

    await this.mentionTracking.recordSent(mentionedUserId, 'comment', filePath, threadId, commentId);
  }

  private sendReplyChainNotifications(
    thread: CommentThread,
    authorEmail: string,
    filePath: string,
    threadId: string,
    newComment: Comment,
  ): void {
    // Collect all participants from existing comments in the thread (excluding the new reply)
    const existingComments = thread.comments.filter((c) => c.id !== newComment.id);
    const pastParticipants = this.mentionTracking.collectThreadParticipants(existingComments);

    // Extract new mentions from the reply
    const newMentions = new Set(extractMentions(newComment.text));

    // Union of all emails to notify
    const allEmails = new Set([...pastParticipants, ...newMentions]);

    // Remove the reply author
    allEmails.delete(authorEmail);

    // Earlier verified commenters who were never mentioned get the in-app
    // item only — who receives reply emails is unchanged.
    const notified = new Set([authorEmail, ...allEmails].map((e) => e.toLowerCase()));
    const commenters = new Set(
      existingComments.filter((c) => c.authorVerified !== false).map((c) => c.author.toLowerCase()),
    );
    for (const email of commenters) {
      if (notified.has(email)) continue;
      void this.recordInboxItem({
        type: 'thread_reply',
        recipientEmail: email,
        actorEmail: authorEmail,
        path: filePath,
        threadId,
        commentId: newComment.id,
        snippet: newComment.text,
      });
    }

    for (const email of allEmails) {
      const isDirectMention = newMentions.has(email);

      this.processReplyNotification(
        email,
        authorEmail,
        newComment.text,
        filePath,
        threadId,
        newComment.id,
        isDirectMention,
      ).catch((err) => {
        this.logger.error(`Failed to process reply notification for ${email}`, err);
      });
    }
  }

  private async processReplyNotification(
    mentionedEmail: string,
    authorEmail: string,
    replyText: string,
    filePath: string,
    threadId: string,
    commentId: string,
    isDirectMention: boolean,
  ): Promise<void> {
    const mentionedUserId = await this.notificationService.resolveUserId(mentionedEmail);
    if (!mentionedUserId) return;

    const authorUserId = await this.notificationService.resolveUserId(authorEmail);
    if (!authorUserId) return;

    // Auto-star for mentioned users
    await this.starsService.autoStarForUser(mentionedUserId, filePath).catch((err) => {
      this.logger.error(`Failed to auto-star ${filePath} for user ${mentionedUserId}`, err);
    });

    await this.recordInboxItem({
      type: isDirectMention ? 'comment_mention' : 'thread_reply',
      recipientEmail: mentionedEmail,
      actorEmail: authorEmail,
      path: filePath,
      threadId,
      commentId,
      snippet: replyText,
    });

    const approved = await this.mentionTracking.shouldSend(
      mentionedUserId,
      authorUserId,
      'comment',
      filePath,
      threadId,
      commentId,
    );
    if (!approved) return;

    await this.notificationService.notifyThreadReply(
      mentionedEmail,
      authorEmail,
      replyText,
      filePath,
      threadId,
      isDirectMention,
    );

    await this.mentionTracking.recordSent(mentionedUserId, 'comment', filePath, threadId, commentId);
  }

  /**
   * In-app inbox item for a comment event. Runs before the email anti-spam
   * gates (cooldown, per-comment dedup) — those throttle email, not the inbox.
   * Self / cross-personal suppression and dedup happen in the inbox service.
   */
  private async recordInboxItem(input: RecordInput): Promise<void> {
    if (!this.inbox) return;
    await this.inbox.record(input).catch((err) => {
      this.logger.error(`Failed to record ${input.type} notification for ${input.recipientEmail}`, err);
    });
  }
}
