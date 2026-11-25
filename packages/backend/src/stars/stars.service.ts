import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StarredItem } from '../entities/starred-item.entity';
import { isTrashPath, isVisibleTo } from '../auth/visibility';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';

@Injectable()
export class StarsService {
  constructor(
    @InjectRepository(StarredItem) private readonly starRepo: Repository<StarredItem>,
    @Optional() private readonly visibility?: GrantAwareVisibility,
  ) {}

  /**
   * A user's stars. Stars on trashed items are dormant and left out. With
   * `viewerEmail`, so are stars on paths the user cannot see now: a note
   * moved into someone's personal folder, or one whose grant ended.
   */
  async listByUser(userId: number, viewerEmail?: string): Promise<StarredItem[]> {
    const rows = await this.starRepo.find({ where: { userId }, order: { createdAt: 'ASC' } });
    if (!viewerEmail) return rows.filter((s) => !isTrashPath(s.path));
    const grants = await this.grantSet(viewerEmail);
    return rows.filter((s) => isVisibleTo(s.path, viewerEmail) || grants.has(s.path));
  }

  async addStar(userId: number, type: 'file' | 'folder', path: string): Promise<StarredItem> {
    const star = this.starRepo.create({ userId, type, path });
    return this.starRepo.save(star);
  }

  /**
   * Star a note for a user mentioned in it, unless they cannot see it: a
   * mention in someone else's personal note must not put its path in their
   * starred list (inbox and email suppress those mentions too).
   */
  async autoStarForUser(userId: number, docPath: string, userEmail: string): Promise<void> {
    const email = userEmail.toLowerCase();
    if (!isVisibleTo(docPath, email) && !(await this.grantSet(email)).has(docPath)) return;
    await this.starRepo
      .createQueryBuilder()
      .insert()
      .into(StarredItem)
      .values({ userId, type: 'file', path: docPath })
      .orIgnore()
      .execute();
  }

  async removeStar(id: number, userId: number): Promise<void> {
    await this.starRepo.delete({ id, userId });
  }

  async updatePaths(oldPath: string, newPath: string): Promise<void> {
    // Exact file match
    await this.starRepo
      .createQueryBuilder()
      .update()
      .set({ path: newPath })
      .where('path = :oldPath', { oldPath })
      .execute();
  }

  async updatePathPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    // Folder rename — update all paths that start with the old prefix
    const items = await this.starRepo
      .createQueryBuilder('s')
      .where('substr(s.path, 1, length(:prefix)) = :prefix', { prefix: oldPrefix })
      .getMany();

    for (const item of items) {
      item.path = newPrefix + item.path.slice(oldPrefix.length);
      await this.starRepo.save(item);
    }
  }

  private async grantSet(email: string): Promise<Set<string>> {
    return this.visibility ? this.visibility.visibleGrantSet(email) : new Set();
  }
}
