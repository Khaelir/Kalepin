import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { InboxNotification, InboxNotificationType } from '../entities/inbox-notification.entity';
import { User } from '../entities/user.entity';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { isVisibleTo } from '../auth/visibility';
import { canonicalizeEmail } from '../auth/email';
import { isE2EPath } from '../crypto/encryption-predicates';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { isCrossPersonalMention } from '../comments/notification.service';
import { buildSnippet } from './notification-snippet';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
/** Upper bound on batches scanned per page when most rows are filtered out. */
const MAX_SCAN_BATCHES = 10;

export interface RecordInput {
  type: InboxNotificationType;
  recipientEmail: string;
  actorEmail: string;
  path: string;
  threadId?: string | null;
  commentId?: string | null;
  heading?: string | null;
  /** Raw text; reduced with `buildSnippet`. */
  snippet?: string | null;
}

export interface InboxItemView {
  id: number;
  type: InboxNotificationType;
  actorEmail: string;
  actorName: string | null;
  path: string;
  threadId: string | null;
  commentId: string | null;
  heading: string | null;
  snippet: string | null;
  createdAt: number;
  readAt: number | null;
  /** False when the note was deleted (or its handle is gone). */
  available: boolean;
}

export interface InboxPage {
  items: InboxItemView[];
  nextBefore: number | null;
}

interface ResolvedPath {
  path: string;
  /** `gone` = the handle is tombstoned or no longer exists. */
  handle: 'active' | 'gone' | 'none';
}

type ChangedListener = (recipientEmail: string) => void;

function canonicalOrNull(email: string): string | null {
  try {
    return canonicalizeEmail(email);
  } catch {
    return null;
  }
}

/**
 * In-app notification items: creation (with the same suppression rules as the
 * emails), the recipient-scoped listing, read state and retention. Paths follow
 * renames through the note's doc handle, which both `FilesService.move` and the
 * external rename tracker keep current — see design.md Decision 4.
 */
@Injectable()
export class NotificationInboxService {
  private readonly logger = new Logger(NotificationInboxService.name);
  private readonly listeners: ChangedListener[] = [];

  constructor(
    @InjectRepository(InboxNotification) private readonly repo: Repository<InboxNotification>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    // Read-only batch lookups; writes go through DocHandlesService.
    @InjectRepository(DocHandle) private readonly handleRepo: Repository<DocHandle>,
    private readonly docHandles: DocHandlesService,
    @Optional() private readonly visibility?: GrantAwareVisibility,
    @Optional() @Inject(STORAGE_ADAPTER) private readonly storage?: StorageAdapter,
  ) {}

  /** Subscribe to "this recipient's inbox changed" (item created or read). */
  onChanged(listener: ChangedListener): void {
    this.listeners.push(listener);
  }

  /**
   * Create an item unless a suppression rule applies: actor == recipient,
   * a mention/reply in someone else's personal note, or a duplicate. Returns
   * the stored row, or null when suppressed. Never subject to the email
   * cooldown or to the recipient's email preference.
   */
  async record(input: RecordInput, now: number = Date.now()): Promise<InboxNotification | null> {
    const recipient = canonicalOrNull(input.recipientEmail);
    const actor = canonicalOrNull(input.actorEmail);
    if (!recipient || !actor || recipient === actor) return null;
    if (input.type !== 'share' && isCrossPersonalMention(input.path, recipient)) return null;

    const handleId = await this.handleFor(input.path);
    if (await this.isDuplicate(recipient, input, handleId)) return null;

    let row: InboxNotification;
    try {
      row = await this.repo.save(this.repo.create({
        recipientEmail: recipient,
        actorEmail: actor,
        type: input.type,
        path: input.path,
        handleId,
        threadId: input.threadId ?? null,
        commentId: input.commentId ?? null,
        heading: input.heading ?? null,
        snippet: buildSnippet(input.snippet, input.path),
        createdAt: now,
        readAt: null,
      }));
    } catch (err) {
      // A concurrent record() for the same (recipient, commentId) won the race.
      if (((err as Error).message ?? '').includes('UNIQUE')) return null;
      throw err;
    }
    this.emitChanged(recipient);
    return row;
  }

  async list(recipientEmail: string, opts: { limit?: number; before?: number } = {}): Promise<InboxPage> {
    const recipient = recipientEmail.toLowerCase();
    const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
    const batchSize = Math.max(limit * 2, DEFAULT_PAGE_SIZE);
    const grants = await this.grantSet(recipient);

    const picked: { row: InboxNotification; resolved: ResolvedPath }[] = [];
    let cursor = opts.before;
    let lastConsumedId: number | null = null;
    let hasMore = false;

    scan: for (let batch = 0; ; batch++) {
      const qb = this.repo
        .createQueryBuilder('n')
        .where('n.recipientEmail = :recipient', { recipient });
      if (cursor !== undefined) qb.andWhere('n.id < :cursor', { cursor });
      const rows = await qb.orderBy('n.id', 'DESC').take(batchSize).getMany();
      const resolved = await this.resolvePaths(rows);
      for (const row of rows) {
        if (picked.length === limit) {
          hasMore = true;
          break scan;
        }
        lastConsumedId = row.id;
        const r = resolved.get(row.id)!;
        if (this.isListable(r.path, recipient, grants)) picked.push({ row, resolved: r });
      }
      if (rows.length < batchSize) break;
      cursor = rows[rows.length - 1].id;
      if (batch + 1 >= MAX_SCAN_BATCHES) {
        hasMore = true;
        break;
      }
    }

    const names = await this.actorNames(picked.map((p) => p.row.actorEmail));
    const items: InboxItemView[] = [];
    for (const { row, resolved } of picked) {
      items.push({
        id: row.id,
        type: row.type,
        actorEmail: row.actorEmail,
        actorName: names.get(row.actorEmail) ?? null,
        path: resolved.path,
        threadId: row.threadId,
        commentId: row.commentId,
        heading: row.heading,
        snippet: isE2EPath(resolved.path) ? null : row.snippet,
        createdAt: row.createdAt,
        readAt: row.readAt,
        available: resolved.handle !== 'gone' && (await this.exists(resolved.path)),
      });
    }
    return { items, nextBefore: hasMore ? lastConsumedId : null };
  }

  /** Unread items whose note the recipient can still see. */
  async unreadCount(recipientEmail: string): Promise<number> {
    const recipient = recipientEmail.toLowerCase();
    const groups: { handleId: string | null; path: string; count: number | string }[] = await this.repo
      .createQueryBuilder('n')
      .select('n.handleId', 'handleId')
      .addSelect('n.path', 'path')
      .addSelect('COUNT(*)', 'count')
      .where('n.recipientEmail = :recipient', { recipient })
      .andWhere('n.readAt IS NULL')
      .groupBy('n.handleId')
      .addGroupBy('n.path')
      .getRawMany();
    if (groups.length === 0) return 0;
    const grants = await this.grantSet(recipient);
    const handles = await this.loadHandles(groups.map((g) => g.handleId));
    let total = 0;
    for (const g of groups) {
      const path = this.currentPath(g.handleId, g.path, handles).path;
      if (this.isListable(path, recipient, grants)) total += Number(g.count);
    }
    return total;
  }

  /** Mark one of the recipient's items read. Unknown or foreign ids → 404. */
  async markRead(recipientEmail: string, id: number, now: number = Date.now()): Promise<void> {
    const recipient = recipientEmail.toLowerCase();
    const row = Number.isInteger(id) && id > 0
      ? await this.repo.findOne({ where: { id, recipientEmail: recipient } })
      : null;
    if (!row) throw new NotFoundException();
    if (row.readAt !== null) return;
    row.readAt = now;
    await this.repo.save(row);
    this.emitChanged(recipient);
  }

  /** Mark every unread item read, including ones hidden by visibility, so
   * retention can prune them. Returns the number of rows updated. */
  async markAllRead(recipientEmail: string, now: number = Date.now()): Promise<number> {
    const recipient = recipientEmail.toLowerCase();
    const result = await this.repo.update({ recipientEmail: recipient, readAt: IsNull() }, { readAt: now });
    const affected = result.affected ?? 0;
    if (affected > 0) this.emitChanged(recipient);
    return affected;
  }

  /** Retention: delete read items created before `cutoff` (unix ms). */
  async deleteReadOlderThan(cutoff: number): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('readAt IS NOT NULL')
      .andWhere('createdAt < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Whether an item for `path` may be shown to `recipient`: the predicate the
   * `/api/updates` feed uses (owner-or-shared-vault, or an active grant).
   * Extra exclusions (e.g. a trash folder) belong here.
   */
  private isListable(path: string, recipient: string, grants: Set<string>): boolean {
    return isVisibleTo(path, recipient) || grants.has(path);
  }

  private async grantSet(recipient: string): Promise<Set<string>> {
    return this.visibility ? this.visibility.visibleGrantSet(recipient) : new Set();
  }

  private async isDuplicate(recipient: string, input: RecordInput, handleId: string | null): Promise<boolean> {
    if (input.commentId) {
      return (await this.repo.count({ where: { recipientEmail: recipient, commentId: input.commentId } })) > 0;
    }
    if (input.type === 'doc_mention' || input.type === 'share') {
      // One unread item per note: absorbs mention undo/redo churn and repeated shares.
      const target = handleId ? { handleId } : { path: input.path };
      return (await this.repo.count({
        where: { recipientEmail: recipient, type: input.type, readAt: IsNull(), ...target },
      })) > 0;
    }
    return false;
  }

  /** Notes get a handle (minted if needed, as the email links do); other
   * targets only reuse an existing one. Null when unavailable. */
  private async handleFor(path: string): Promise<string | null> {
    try {
      return path.endsWith('.md')
        ? await this.docHandles.findOrCreateForPath(path)
        : await this.docHandles.forPath(path);
    } catch (err) {
      this.logger.warn(`No doc handle for "${path}": ${(err as Error).message}`);
      return null;
    }
  }

  private async loadHandles(ids: (string | null)[]): Promise<Map<string, DocHandle>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const rows = await this.handleRepo.find({ where: { id: In(unique) } });
    return new Map(rows.map((h) => [h.id, h]));
  }

  private currentPath(handleId: string | null, storedPath: string, handles: Map<string, DocHandle>): ResolvedPath {
    if (!handleId) return { path: storedPath, handle: 'none' };
    const h = handles.get(handleId);
    if (!h || h.tombstoneAt !== null) return { path: storedPath, handle: 'gone' };
    return { path: h.path, handle: 'active' };
  }

  /** Resolve each row's current path and lazily persist paths that moved. */
  private async resolvePaths(rows: InboxNotification[]): Promise<Map<number, ResolvedPath>> {
    const handles = await this.loadHandles(rows.map((r) => r.handleId));
    const out = new Map<number, ResolvedPath>();
    const moved = new Map<string, string>();
    for (const row of rows) {
      const r = this.currentPath(row.handleId, row.path, handles);
      out.set(row.id, r);
      if (r.handle === 'active' && r.path !== row.path) moved.set(row.handleId!, r.path);
    }
    for (const [handleId, path] of moved) {
      const patch: Partial<InboxNotification> = { path };
      if (isE2EPath(path)) patch.snippet = null;
      await this.repo.update({ handleId, path: Not(path) }, patch).catch((err) => {
        this.logger.warn(`Failed to refresh notification path for handle ${handleId}: ${(err as Error).message}`);
      });
    }
    return out;
  }

  private async exists(path: string): Promise<boolean> {
    if (!this.storage) return true;
    try {
      return await this.storage.exists(path);
    } catch {
      return false;
    }
  }

  private async actorNames(emails: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(emails)];
    if (unique.length === 0) return new Map();
    const users = await this.userRepo.find({ where: { email: In(unique) } });
    const names = new Map<string, string>();
    for (const u of users) if (u.displayName) names.set(u.email, u.displayName);
    return names;
  }

  private emitChanged(recipient: string): void {
    for (const listener of this.listeners) {
      try {
        listener(recipient);
      } catch (err) {
        this.logger.warn(`notifications:changed listener failed: ${(err as Error).message}`);
      }
    }
  }
}
