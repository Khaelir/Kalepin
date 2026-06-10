import { Injectable, Inject } from '@nestjs/common';
import * as path from 'path';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { SidecarData, CommentThread } from '@kalepin/shared';

@Injectable()
export class SidecarService {
  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  sidecarPath(filePath: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    return path.join(dir, `.${base}.collab`);
  }

  async read(filePath: string): Promise<SidecarData> {
    const sPath = this.sidecarPath(filePath);
    try {
      const content = await this.storage.read(sPath);
      return JSON.parse(content);
    } catch {
      return { comments: {} };
    }
  }

  async write(filePath: string, data: SidecarData): Promise<void> {
    const sPath = this.sidecarPath(filePath);
    await this.storage.write(sPath, JSON.stringify(data, null, 2));
  }

  async getThreadsForDocument(filePath: string): Promise<CommentThread[]> {
    const data = await this.read(filePath);
    const threads: CommentThread[] = [];
    for (const [blockId, block] of Object.entries(data.comments)) {
      for (const thread of block.threads) {
        threads.push({ ...thread, blockId });
      }
    }
    return threads;
  }
}
