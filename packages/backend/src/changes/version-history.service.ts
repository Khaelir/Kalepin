import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { applyPatch } from 'diff';
import { NoteChange, NoteSnapshot, User } from '../entities';

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

  async getHistory(path: string): Promise<HistoryEntry[]> {
    const changes = await this.changeRepo.find({
      where: { path },
      order: { createdAt: 'DESC' },
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

  async reconstructVersion(path: string, changeId: number): Promise<{ content: string; partial: boolean }> {
    // Find the nearest snapshot at or before the target changeId
    const snapshot = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.path = :path AND s.changeId <= :changeId', { path, changeId })
      .orderBy('s.changeId', 'DESC')
      .getOne();

    // Get changes to replay: from snapshot (or beginning) up to and including changeId
    const qb = this.changeRepo
      .createQueryBuilder('c')
      .where('c.path = :path AND c.id <= :changeId', { path, changeId })
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
