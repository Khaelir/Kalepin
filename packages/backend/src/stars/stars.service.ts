import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StarredItem } from '../entities/starred-item.entity';

@Injectable()
export class StarsService {
  constructor(
    @InjectRepository(StarredItem) private readonly starRepo: Repository<StarredItem>,
  ) {}

  async listByUser(userId: number): Promise<StarredItem[]> {
    return this.starRepo.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async addStar(userId: number, type: 'file' | 'folder', path: string): Promise<StarredItem> {
    const star = this.starRepo.create({ userId, type, path });
    return this.starRepo.save(star);
  }

  async autoStarForUser(userId: number, docPath: string): Promise<void> {
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
      .where('s.path LIKE :prefix', { prefix: `${oldPrefix}%` })
      .getMany();

    for (const item of items) {
      item.path = newPrefix + item.path.slice(oldPrefix.length);
      await this.starRepo.save(item);
    }
  }
}
