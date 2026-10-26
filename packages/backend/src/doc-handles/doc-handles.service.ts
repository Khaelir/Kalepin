import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { DocHandle } from '../entities/doc-handle.entity';

/** Base32 alphabet RFC 4648 (`A-Z2-7`). 5 bits per char × 16 chars = 80 bits. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HANDLE_LEN = 16;
/** Paths per `IN (...)` query, well under SQLite's bound-parameter limit. */
const LOOKUP_BATCH = 500;

/** Returns a fresh 16-char base32 id. Caller is responsible for collision retry. */
export function generateHandleId(): string {
  // 16 base32 chars × 5 bits = 80 bits. 10 random bytes covers it exactly.
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(value >>> bits) & 0x1f];
    }
  }
  return out.slice(0, HANDLE_LEN);
}

export interface ResolveResult {
  path: string;
  tombstoned: boolean;
}

@Injectable()
export class DocHandlesService {
  private readonly logger = new Logger(DocHandlesService.name);

  constructor(
    @InjectRepository(DocHandle) private readonly repo: Repository<DocHandle>,
  ) {}

  /** Idempotent mint. Returns the existing id when one already exists. If the
   * existing row is tombstoned for the same path (e.g. a backup-restore corner
   * case where the file reappears at the same path), the row is reactivated. */
  async findOrCreateForPath(path: string): Promise<string> {
    const existing = await this.repo.findOne({ where: { path } });
    if (existing) {
      if (existing.tombstoneAt !== null) {
        existing.tombstoneAt = null;
        await this.repo.save(existing);
      }
      return existing.id;
    }
    return this.mintNew(path);
  }

  /** Batch findOrCreateForPath, returning a path → id map covering every
   * input. Paths with an active row are read in bulk; the rest (no row yet, or
   * a tombstoned one) go through findOrCreateForPath one by one. */
  async findOrCreateForPaths(paths: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(paths)];
    const ids = new Map<string, string>();
    for (let i = 0; i < unique.length; i += LOOKUP_BATCH) {
      const rows = await this.repo.find({
        where: { path: In(unique.slice(i, i + LOOKUP_BATCH)), tombstoneAt: IsNull() },
      });
      for (const row of rows) ids.set(row.path, row.id);
    }
    for (const path of unique) {
      if (!ids.has(path)) ids.set(path, await this.findOrCreateForPath(path));
    }
    return ids;
  }

  /** Look up an id for a path without minting. Returns null when no row exists. */
  async forPath(path: string): Promise<string | null> {
    const row = await this.repo.findOne({ where: { path } });
    return row?.id ?? null;
  }

  /** Resolve a handle id to its path + tombstone status. Throws NotFoundException
   * for an unknown id. */
  async resolve(id: string): Promise<ResolveResult> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Handle not found');
    return { path: row.path, tombstoned: row.tombstoneAt !== null };
  }

  /** Update the path of an existing row. Used on rename/move so the handle id
   * is preserved. No-op when the id does not exist. */
  async updatePath(id: string, newPath: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ path: newPath })
      .where('id = :id', { id })
      .execute();
  }

  /** Update the path of the row matching `oldPath`, if any. Convenience for
   * call-sites that have a path rather than an id. */
  async updatePathByPath(oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) return;
    const row = await this.repo.findOne({ where: { path: oldPath } });
    if (row) await this.repathRow(row.id, newPath);
  }

  /** Rewrite all rows whose path starts with `oldPrefix + '/'`. Used by folder
   * rename/move so handles for files inside the moved folder follow. */
  async updatePathPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    const items = await this.repo
      .createQueryBuilder('h')
      .where('h.path LIKE :prefix', { prefix: `${oldPrefix}/%` })
      .getMany();
    for (const item of items) {
      await this.repathRow(item.id, newPrefix + item.path.slice(oldPrefix.length));
    }
  }

  /**
   * Point row `id` at `newPath`, keeping its id so existing /doc/<id> URLs
   * follow a rename. Another row may already hold `newPath`: the tombstone of
   * a file deleted there earlier, or one the file watcher minted when it saw
   * the moved file appear before this update ran. The moved file's row wins.
   */
  private async repathRow(id: string, newPath: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      await this.repo
        .createQueryBuilder()
        .delete()
        .where('path = :newPath', { newPath })
        .andWhere('id != :id', { id })
        .execute();
      try {
        await this.repo
          .createQueryBuilder()
          .update()
          .set({ path: newPath })
          .where('id = :id', { id })
          .execute();
        return;
      } catch (err) {
        // A watcher mint can land between the delete and the update.
        const msg = (err as Error).message ?? '';
        if (attempt >= 2 || !(msg.includes('UNIQUE') && msg.includes('path'))) throw err;
      }
    }
  }

  /** Stamp tombstoneAt on the matching row. No-op when no row exists. */
  async tombstone(id: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ tombstoneAt: Date.now() })
      .where('id = :id', { id })
      .andWhere('tombstoneAt IS NULL')
      .execute();
  }

  /** Tombstone by path, if a row exists. Convenience for filewatcher / delete
   * call-sites that don't pre-resolve the id. */
  async tombstoneByPath(path: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ tombstoneAt: Date.now() })
      .where('path = :path', { path })
      .andWhere('tombstoneAt IS NULL')
      .execute();
  }

  /** Reactivate a tombstoned row. Used by the backup-restore corner case where
   * the file reappears at the same path before any new mint. */
  async untombstone(id: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ tombstoneAt: null })
      .where('id = :id', { id })
      .execute();
  }

  private async mintNew(path: string): Promise<string> {
    // Collision is astronomically unlikely (80 bits) but we still retry on
    // PRIMARY KEY violation. The path UNIQUE index also ensures we don't
    // double-insert under a race; the catch falls through to a re-read.
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = generateHandleId();
      try {
        const now = Date.now();
        await this.repo.insert({ id, path, createdAt: now, tombstoneAt: null });
        return id;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        // Race: another caller minted for the same path. Re-read and return.
        if (msg.includes('UNIQUE') && msg.includes('path')) {
          const row = await this.repo.findOne({ where: { path } });
          if (row) return row.id;
        }
        // Otherwise loop and try a new id.
        this.logger.warn(`mint retry for "${path}" attempt ${attempt}: ${msg}`);
      }
    }
    throw new Error(`Failed to mint doc handle for "${path}" after 5 attempts`);
  }
}
