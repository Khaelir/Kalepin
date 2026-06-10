import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MentionNotification } from '../entities/mention-notification.entity';
import { User } from '../entities/user.entity';
import { extractMentions } from './extract-mentions';
import { extractDocMentions } from './extract-doc-mentions';
import { SidecarService } from './sidecar.service';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import type { FileEntry } from '@kalepin/shared';

const COOLDOWN_SECONDS = 10;

@Injectable()
export class MentionTrackingService {
  private readonly logger = new Logger(MentionTrackingService.name);

  constructor(
    @InjectRepository(MentionNotification)
    private readonly repo: Repository<MentionNotification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly sidecar: SidecarService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * Anti-spam pipeline. Returns true if the notification should be sent.
   * Gates (checked in order):
   * 1. Self-mention → skip
   * 2. Per-event dedup (commentId for comments, docPath for docs)
   * 3. Hard cooldown (10s per user)
   */
  async shouldSend(
    userId: number,
    authorUserId: number,
    type: 'doc' | 'comment',
    docPath: string,
    threadId?: string,
    commentId?: string,
  ): Promise<boolean> {
    // 1. Self-mention
    if (userId === authorUserId) {
      return false;
    }

    // 2. Per-event dedup
    if (type === 'comment' && commentId) {
      const existing = await this.repo.findOne({
        where: { userId, commentId },
      });
      if (existing) return false;
    } else if (type === 'doc') {
      const existing = await this.repo.findOne({
        where: { userId, type: 'doc', docPath },
      });
      if (existing) return false;
    }

    // 3. Hard cooldown — any notification sent to this user in the last 10s
    const cutoff = new Date(Date.now() - COOLDOWN_SECONDS * 1000);
    const recent = await this.repo
      .createQueryBuilder('mn')
      .where('mn.userId = :userId', { userId })
      .andWhere('mn.sentAt > :cutoff', { cutoff })
      .getOne();
    if (recent) return false;

    return true;
  }

  async recordSent(
    userId: number,
    type: 'doc' | 'comment',
    docPath: string,
    threadId?: string,
    commentId?: string,
  ): Promise<void> {
    await this.repo.save({
      userId,
      type,
      docPath,
      threadId: threadId ?? null,
      commentId: commentId ?? null,
    });
  }

  /**
   * Collect all unique emails mentioned across all comments in a thread.
   */
  collectThreadParticipants(comments: { text: string }[]): Set<string> {
    const participants = new Set<string>();
    for (const comment of comments) {
      for (const email of extractMentions(comment.text)) {
        participants.add(email);
      }
    }
    return participants;
  }

  /**
   * One-time backfill: mark all pre-existing mentions (comments + docs) as
   * already notified so they never trigger emails. Idempotent via a marker
   * record (userId=0, type='backfill').
   */
  async backfillExistingMentions(): Promise<void> {
    const marker = await this.repo.findOne({ where: { userId: 0, type: 'doc' as any, docPath: '__backfill__' } });
    if (marker) return;

    this.logger.log('Backfilling mention tracking for pre-existing mentions...');

    // Build email → userId lookup
    const users = await this.userRepo.find();
    const emailToId = new Map<string, number>();
    for (const u of users) emailToId.set(u.email, u.id);

    const mdFiles = this.collectFiles(await this.storage.list(''));
    let count = 0;

    // 1. Comment mentions from sidecar files
    for (const filePath of mdFiles) {
      const data = await this.sidecar.read(filePath);
      for (const block of Object.values(data.comments)) {
        for (const thread of block.threads) {
          for (const comment of thread.comments) {
            const emails = extractMentions(comment.text);
            for (const email of emails) {
              const uid = emailToId.get(email);
              if (!uid) continue;
              await this.repo.save({ userId: uid, type: 'comment' as const, docPath: filePath, threadId: thread.id, commentId: comment.id });
              count++;
            }
          }
        }
      }

      // 2. Doc mentions from markdown content
      try {
        const content = await this.storage.read(filePath);
        const docEmails = extractDocMentions(content);
        for (const email of docEmails) {
          const uid = emailToId.get(email);
          if (!uid) continue;
          await this.repo.save({ userId: uid, type: 'doc' as const, docPath: filePath });
          count++;
        }
      } catch { /* file unreadable, skip */ }
    }

    // Insert marker
    await this.repo.save({ userId: 0, type: 'doc' as any, docPath: '__backfill__' });
    this.logger.log(`Backfill complete: ${count} mention tracking records created.`);
  }

  private collectFiles(entries: FileEntry[]): string[] {
    const files: string[] = [];
    for (const e of entries) {
      if (e.type === 'file' && e.name.endsWith('.md')) {
        files.push(e.path);
      } else if (e.type === 'directory' && e.children) {
        files.push(...this.collectFiles(e.children));
      }
    }
    return files;
  }
}
