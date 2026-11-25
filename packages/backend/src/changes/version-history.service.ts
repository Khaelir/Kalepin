import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { applyPatch } from 'diff';
import { NoteChange, NoteSnapshot, User } from '../entities';
import { isUnderPersonalRoot, isVisibleTo } from '../auth/visibility';

export interface HistoryEntry {
  id: number;
  action: 'created' | 'modified' | 'deleted';
  userId: number | null;
  userEmail: string | null;
  createdAt: string;
}

@Injectable()
export class VersionHistoryService {
  constructor(
    @InjectRepository(NoteChange) private readonly changeRepo: Repository<NoteChange>,
    @InjectRepository(NoteSnapshot) private readonly snapshotRepo: Repository<NoteSnapshot>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /**
   * History rows are keyed by path only, so a path can hold the history of
   * an earlier note that was deleted or moved away. Its owner may see it all;
   * anyone else (a grantee) sees only the note now at the path: the rows from
   * its latest `created` change on, or after its latest `deleted` one.
   * Returns the lowest change id `viewerEmail` may see.
   */
  private async firstVisibleChangeId(path: string, viewerEmail?: string): Promise<number> {
    if (!viewerEmail || !isUnderPersonalRoot(path) || isVisibleTo(path, viewerEmail)) return 0;
    const boundary = await this.changeRepo.findOne({
      where: { path, action: In(['created', 'deleted']) },
      order: { id: 'DESC' },
    });
    if (!boundary) return 0;
    return boundary.action === 'created' ? boundary.id : boundary.id + 1;
  }

  async getHistory(path: string, viewerEmail?: string): Promise<HistoryEntry[]> {
    const firstId = await this.firstVisibleChangeId(path, viewerEmail);
    const changes = await this.changeRepo.find({
      where: { path, id: MoreThanOrEqual(firstId) },
      // createdAt has one-second resolution: the id breaks ties, newest first.
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    // Batch-load user emails
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

    // History is per-file: vault audit rows are filtered upstream by `path`,
    // but be defensive and narrow the action union here.
    return changes
      .filter((c) => c.action === 'created' || c.action === 'modified' || c.action === 'deleted')
      .map((c) => ({
        id: c.id,
        action: c.action as 'created' | 'modified' | 'deleted',
        userId: c.userId,
        userEmail: c.userId ? (userEmailMap.get(c.userId) ?? null) : null,
        createdAt: c.createdAt.toISOString(),
      }));
  }

  async reconstructVersion(path: string, changeId: number, viewerEmail?: string): Promise<{ content: string; partial: boolean }> {
    // Never rebuild from, or return, an earlier note's rows (see getHistory).
    const firstId = await this.firstVisibleChangeId(path, viewerEmail);
    if (changeId < firstId) throw new NotFoundException('Version not found');

    // Find the nearest snapshot at or before the target changeId
    const snapshot = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.path = :path AND s.changeId <= :changeId', { path, changeId })
      .andWhere('s.changeId >= :firstId', { firstId })
      .orderBy('s.changeId', 'DESC')
      .getOne();

    // Get changes to replay: from snapshot (or beginning) up to and including changeId
    const qb = this.changeRepo
      .createQueryBuilder('c')
      .where('c.path = :path AND c.id <= :changeId', { path, changeId })
      .andWhere('c.id >= :firstId', { firstId })
      .orderBy('c.id', 'ASC');

    if (snapshot) {
      qb.andWhere('c.id > :snapshotChangeId', { snapshotChangeId: snapshot.changeId });
    }

    const changes = await qb.getMany();

    let content = snapshot?.content ?? '';
    let partial = false;

    for (const change of changes) {
      if (!change.diff) continue;

      // Try strict application first, then retry with fuzz factor
      let result = applyPatch(content, change.diff);
      if (result === false) {
        result = applyPatch(content, change.diff, { fuzzFactor: 3 });
      }
      if (result === false) {
        // Skip this diff and continue with remaining changes
        partial = true;
        continue;
      }
      content = result;
    }

    // If we ended up with nothing useful, fall back to the nearest snapshot
    if (!content && partial) {
      // Try snapshot before target (already checked above)
      if (snapshot?.content) {
        content = snapshot.content;
      } else {
        // Try the closest snapshot after the target changeId
        const laterSnapshot = await this.snapshotRepo
          .createQueryBuilder('s')
          .where('s.path = :path AND s.changeId > :changeId', { path, changeId })
          .orderBy('s.changeId', 'ASC')
          .getOne();
        if (laterSnapshot?.content) {
          content = laterSnapshot.content;
        }
      }
    }

    return { content, partial };
  }

  /** Force-create a snapshot of current content so the pre-restore state is preserved in history. */
  async createPreRestoreSnapshot(path: string, currentContent: string, userId: number | null): Promise<void> {
    const change = this.changeRepo.create({ path, action: 'modified', diff: null, userId });
    await this.changeRepo.save(change);
    await this.snapshotRepo.save(
      this.snapshotRepo.create({ path, changeId: change.id, content: currentContent }),
    );
  }
}
