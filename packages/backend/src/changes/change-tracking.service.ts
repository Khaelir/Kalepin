import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import * as crypto from 'crypto';
import { NoteChange, NoteSnapshot } from '../entities';
import { User } from '../entities';
import type { NoteChangeOpType } from '../entities/note-change.entity';
import { computeUnifiedDiff } from './compute-diff';
import { isVisibleTo } from '../auth/visibility';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';

interface FileChangeSummary {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  changes: number;
  lastChangedAt: string;
  user: string | null;
  diffs: (string | null)[];
  /** True if any row in this group stored hashes/sizes only (E2E content). */
  metadataOnly: boolean;
}

interface FolderGroup {
  folder: string;
  files: FileChangeSummary[];
}

export interface StarredItemRef {
  type: 'file' | 'folder';
  path: string;
}

export interface UpdatesResponse {
  period: { since: string | null; until: string };
  stats: { created: number; modified: number; deleted: number };
  starred: FolderGroup[];
  other: FolderGroup[];
}

export interface RecentlyEditedItem {
  path: string;
  name: string;
  editorId: number | null;
  editorEmail: string | null;
  editorDisplayName: string | null;
  modifiedAt: string;
}

@Injectable()
export class ChangeTrackingService {
  private readonly logger = new Logger(ChangeTrackingService.name);
  private readonly snapshotInterval = parseInt(process.env.SNAPSHOT_INTERVAL || '20', 10);

  constructor(
    @InjectRepository(NoteChange) private readonly changeRepo: Repository<NoteChange>,
    @InjectRepository(NoteSnapshot) private readonly snapshotRepo: Repository<NoteSnapshot>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Optional()
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates | null = null,
    @Optional() private readonly visibility?: GrantAwareVisibility,
  ) {}

  private async grantSet(viewerEmail?: string): Promise<Set<string>> {
    if (!viewerEmail || !this.visibility) return new Set();
    return this.visibility.visibleGrantSet(viewerEmail);
  }

  async trackChange(
    path: string,
    action: 'created' | 'modified' | 'deleted',
    oldContent?: string | null,
    newContent?: string | null,
    userId?: number | null,
  ): Promise<void> {
    // Stage-2 seam: if the predicate says we cannot index plaintext for this
    // path, store hashes/sizes/op_type only — never the diff or a snapshot of
    // the body. In stage 1 the predicate is true everywhere, so this branch is
    // inert. Wired now so stage 2 flips `shouldIndexPlaintext` and nothing else.
    if (this.predicates && !this.predicates.shouldIndexPlaintext(path)) {
      const oldHash = oldContent != null ? sha256(oldContent) : null;
      const newHash = newContent != null ? sha256(newContent) : null;
      const opType = classifyEdit(oldContent, newContent);
      const change = this.changeRepo.create({
        path,
        action,
        diff: null,
        userId: userId ?? null,
        metadataOnly: 1,
        oldHash,
        newHash,
        opType,
      });
      await this.changeRepo.save(change);
      return;
    }

    let diff: string | null = null;

    if (action === 'created' && newContent) {
      diff = computeUnifiedDiff('', newContent, path);
    } else if (action === 'modified' && oldContent != null && newContent != null) {
      diff = computeUnifiedDiff(oldContent, newContent, path);
    }
    // For 'deleted', diff stays null

    const change = this.changeRepo.create({ path, action, diff, userId: userId ?? null });
    await this.changeRepo.save(change);

    // Store snapshot on creation (initial content) or every N changes
    if (action === 'created' && newContent != null) {
      await this.snapshotRepo.save(
        this.snapshotRepo.create({ path, changeId: change.id, content: newContent }),
      );
    } else if (action === 'modified' && newContent != null) {
      const sinceLastSnapshot = await this.countChangesSinceLastSnapshot(path);
      if (sinceLastSnapshot >= this.snapshotInterval) {
        await this.snapshotRepo.save(
          this.snapshotRepo.create({ path, changeId: change.id, content: newContent }),
        );
      }
    }
  }

  private async countChangesSinceLastSnapshot(path: string): Promise<number> {
    const lastSnapshot = await this.snapshotRepo.findOne({
      where: { path },
      order: { changeId: 'DESC' },
    });

    const qb = this.changeRepo
      .createQueryBuilder('c')
      .where('c.path = :path', { path });

    if (lastSnapshot) {
      qb.andWhere('c.id > :lastChangeId', { lastChangeId: lastSnapshot.changeId });
    }

    return qb.getCount();
  }

  async getChangesSince(since: Date | null, excludeUserId?: number, starredItems?: StarredItemRef[], viewerEmail?: string): Promise<UpdatesResponse> {
    const now = new Date();

    const qb = this.changeRepo
      .createQueryBuilder('c')
      .orderBy('c.createdAt', 'ASC');

    if (since) {
      // SQLite stores datetimes without 'T' or 'Z' — format to match
      const sinceStr = since.toISOString().replace('T', ' ').replace('Z', '');
      qb.where('c.createdAt > :since', { since: sinceStr });
    }

    if (excludeUserId != null) {
      const clause = since ? 'andWhere' : 'where';
      qb[clause]('(c.userId IS NULL OR c.userId != :excludeUserId)', { excludeUserId });
    }

    const allChanges = await qb.getMany();
    // Filter rows by viewer visibility — diffs leak content, so the predicate runs
    // BEFORE grouping so suppressed rows never contribute to stats either.
    const grants = await this.grantSet(viewerEmail);
    const changes = viewerEmail
      ? allChanges.filter((c) => isVisibleTo(c.path, viewerEmail) || grants.has(c.path))
      : allChanges;

    // Batch-load user emails for attribution
    const userIds = [...new Set(changes.map((c) => c.userId).filter((id): id is number => id != null))];
    const userEmailMap = new Map<number, string>();
    if (userIds.length > 0) {
      const users = await this.userRepo
        .createQueryBuilder('u')
        .where('u.id IN (:...userIds)', { userIds })
        .getMany();
      for (const u of users) {
        userEmailMap.set(u.id, u.email);
      }
    }

    // Group by file path. Vault audit rows (`vault.reset*`) are not file
    // mutations and never appear in file-change summaries.
    const byFile = new Map<string, NoteChange[]>();
    for (const change of changes) {
      if (change.action !== 'created' && change.action !== 'modified' && change.action !== 'deleted') {
        continue;
      }
      const existing = byFile.get(change.path) || [];
      existing.push(change);
      byFile.set(change.path, existing);
    }

    // Compute stats
    const stats = { created: 0, modified: 0, deleted: 0 };
    const fileSummaries: FileChangeSummary[] = [];

    for (const [filePath, fileChanges] of byFile) {
      const lastChange = fileChanges[fileChanges.length - 1];
      const action = lastChange.action as 'created' | 'modified' | 'deleted';
      stats[action]++;

      fileSummaries.push({
        path: filePath,
        action,
        changes: fileChanges.length,
        lastChangedAt: lastChange.createdAt.toISOString(),
        user: lastChange.userId ? (userEmailMap.get(lastChange.userId) ?? null) : null,
        diffs: fileChanges.map((c) => c.diff),
        metadataOnly: fileChanges.some((c) => c.metadataOnly === 1),
      });
    }

    // Split into starred/other if starred items provided
    const isStarred = (filePath: string): boolean => {
      if (!starredItems || starredItems.length === 0) return false;
      return starredItems.some((star) => {
        if (star.type === 'file') return filePath === star.path;
        // Folder star: match if path starts with the folder prefix
        return filePath.startsWith(star.path);
      });
    };

    const starredSummaries: FileChangeSummary[] = [];
    const otherSummaries: FileChangeSummary[] = [];

    for (const summary of fileSummaries) {
      if (isStarred(summary.path)) {
        starredSummaries.push(summary);
      } else {
        otherSummaries.push(summary);
      }
    }

    const groupByFolder = (summaries: FileChangeSummary[]): FolderGroup[] => {
      const folderMap = new Map<string, FileChangeSummary[]>();
      for (const summary of summaries) {
        const parts = summary.path.split('/');
        const folder = parts.length > 1 ? parts[0] + '/' : '/';
        const existing = folderMap.get(folder) || [];
        existing.push(summary);
        folderMap.set(folder, existing);
      }
      return [...folderMap.entries()].map(([folder, files]) => ({ folder, files }));
    };

    return {
      period: {
        since: since?.toISOString() ?? null,
        until: now.toISOString(),
      },
      stats,
      starred: groupByFolder(starredSummaries),
      other: groupByFolder(otherSummaries),
    };
  }

  async getRecentlyEdited(limit = 200, viewerEmail?: string): Promise<RecentlyEditedItem[]> {
    // Latest change row per path. Sub-select MAX(id) per path keeps it portable across SQLite/Postgres.
    // Visibility predicate runs after the SQL query (path is small, the row count is bounded).
    const rows = await this.changeRepo
      .createQueryBuilder('c')
      .innerJoin(
        (qb) =>
          qb
            .select('path', 'p')
            .addSelect('MAX(id)', 'max_id')
            .from(NoteChange, 'cc')
            .where("cc.action != 'deleted'")
            .groupBy('cc.path'),
        'latest',
        'latest.max_id = c.id',
      )
      .orderBy('c.createdAt', 'DESC')
      .limit(limit)
      .getMany();

    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is number => id != null))];
    const userMap = new Map<number, { email: string; displayName: string | null }>();
    if (userIds.length > 0) {
      const users = await this.userRepo
        .createQueryBuilder('u')
        .where('u.id IN (:...userIds)', { userIds })
        .getMany();
      for (const u of users) {
        userMap.set(u.id, { email: u.email, displayName: u.displayName ?? null });
      }
    }

    const recentGrants = await this.grantSet(viewerEmail);
    return rows
      .filter((r) => !viewerEmail || isVisibleTo(r.path, viewerEmail) || recentGrants.has(r.path))
      .map((r) => {
        const name = (r.path.split('/').pop() ?? r.path).replace(/\.md$/, '');
        const editor = r.userId != null ? userMap.get(r.userId) : null;
        return {
          path: r.path,
          name,
          editorId: r.userId,
          editorEmail: editor?.email ?? null,
          editorDisplayName: editor?.displayName ?? null,
          modifiedAt: r.createdAt.toISOString(),
        };
      });
  }

  /**
   * Prune version history data (note_changes + note_snapshots) older than retention period.
   * This is separate from feed pruning — the feed UI may show a shorter window,
   * but the underlying change data is kept for version history.
   */
  async pruneVersionHistory(): Promise<void> {
    const retentionDays = parseInt(process.env.VERSION_HISTORY_RETENTION_DAYS || '365', 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().replace('T', ' ').replace('Z', '');

    const deletedSnapshots = await this.snapshotRepo
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoff', { cutoff: cutoffStr })
      .execute();

    const deletedChanges = await this.changeRepo
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoff', { cutoff: cutoffStr })
      .execute();

    const total = (deletedSnapshots.affected || 0) + (deletedChanges.affected || 0);
    if (total > 0) {
      this.logger.debug(
        `Pruned version history: ${deletedChanges.affected} changes, ${deletedSnapshots.affected} snapshots (retention: ${retentionDays} days)`,
      );
    }
  }
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function classifyEdit(
  oldContent: string | null | undefined,
  newContent: string | null | undefined,
): NoteChangeOpType | null {
  const hadOld = oldContent != null && oldContent.length > 0;
  const hasNew = newContent != null && newContent.length > 0;
  if (!hadOld && hasNew) return 'insert';
  if (hadOld && !hasNew) return 'delete';
  if (hadOld && hasNew) return 'replace';
  return null;
}
