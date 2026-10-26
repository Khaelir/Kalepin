import { Injectable, Inject, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FileChangeEvent, FileEntry } from '@kalepin/shared';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { FileWatcherService } from '../files/file-watcher.service';
import { FilesService } from '../files/files.service';
import { isVisibleTo, personalRootFor } from '../auth/visibility';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { escapeLike } from '../auth/like-escape';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
  isE2EPath,
} from '../crypto/encryption-predicates';
import { normalizeTagKey, parseTags } from './tag-parser';
import * as path from 'path';

export interface TagCount {
  /** Display form (most frequent casing). Matching is case-insensitive. */
  tag: string;
  /** Distinct visible notes carrying the tag or any nested child tag. */
  count: number;
}

export interface TaggedNote {
  path: string;
  title: string;
  modifiedAt: string | null;
}

/** Bump when the parsing rules change: boot then rescans notes indexed by an older version. */
export const TAG_PARSER_VERSION = 1;

const TAG_HEAL_SWEEP_INTERVAL_MS = 10 * 60_000;
const INSERT_CHUNK = 300;

/**
 * Maintains `note_tags` (one row per tag per note) the same way
 * LinkIndexService maintains `note_links`: internal writes, watcher events
 * (shared and personal), FilesService moves, a heal sweep and a boot-time
 * backfill. Rows are namespace-blind; visibility is applied at query time.
 * End-to-end encrypted paths and dot-folders are never indexed.
 */
@Injectable()
export class TagIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TagIndexService.name);
  private healSweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Every index write runs on this chain so DELETE + INSERT pairs never interleave. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly fileWatcher: FileWatcherService,
    @Optional() private readonly filesService?: FilesService,
    @Optional() @Inject(ENCRYPTION_PREDICATES) private readonly predicates?: EncryptionPredicates,
    @Optional() private readonly visibility?: GrantAwareVisibility,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.createMetaTable();
    if (await this.needsFullScan()) {
      await this.fullScan();
    }

    const onChange = (event: FileChangeEvent): void => {
      this.handleWatcherEvent(event).catch((err) => {
        this.logger.warn(`tag index update failed for "${event.path}": ${(err as Error).message}`);
      });
    };
    this.fileWatcher.onFileChange(onChange);
    this.fileWatcher.onPersonalChange(onChange);

    // Internal-write fast path: the content is already in memory.
    this.fileWatcher.onInternalWrite(async (notePath, content) => {
      if (!notePath.endsWith('.md')) return;
      try {
        await this.indexFile(notePath, content);
      } catch (err) {
        this.logger.warn(`internal-write tag index update failed for "${notePath}": ${(err as Error).message}`);
      }
    });

    this.filesService?.registerMoveHooks({
      afterMove: (src, dest) => this.renamePath(src, dest),
    });

    this.healSweepTimer = setInterval(() => {
      this.healSweep().catch((err) => {
        this.logger.warn(`tag heal sweep failed: ${(err as Error).message}`);
      });
    }, TAG_HEAL_SWEEP_INTERVAL_MS);
    this.healSweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.healSweepTimer) clearInterval(this.healSweepTimer);
  }

  // --- Indexing ---

  /** False for E2E paths (`_users/{email}/_secure/…`) and anything inside a dot-folder. */
  private isIndexableLocation(p: string): boolean {
    if (p.split('/').some((segment) => segment.startsWith('.'))) return false;
    return this.predicates ? this.predicates.shouldIndexPlaintext(p) : !isE2EPath(p);
  }

  private isIndexable(p: string): boolean {
    return p.endsWith('.md') && this.isIndexableLocation(p);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private async handleWatcherEvent(event: FileChangeEvent): Promise<void> {
    if (event.event === 'unlinkDir') {
      await this.removePrefix(event.path);
      return;
    }
    if (!event.path.endsWith('.md')) return;
    if (event.event === 'unlink') {
      await this.removeFile(event.path);
      return;
    }
    if (event.event !== 'add' && event.event !== 'change') return;
    if (!this.isIndexable(event.path)) {
      await this.removeFile(event.path);
      return;
    }
    let content: string;
    try {
      content = await this.storage.read(event.path);
    } catch {
      return; // gone between the event and the read
    }
    await this.indexFile(event.path, content);
  }

  /** Replace the rows of one note. Non-indexable paths are purged instead. */
  indexFile(notePath: string, content: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.isIndexable(notePath)) {
        await this.deleteRows(notePath);
        return;
      }
      const tags = parseTags(content);
      await this.dataSource.query(`DELETE FROM note_tags WHERE path = ?`, [notePath]);
      for (let i = 0; i < tags.length; i += INSERT_CHUNK) {
        const chunk = tags.slice(i, i + INSERT_CHUNK);
        await this.dataSource.query(
          `INSERT OR REPLACE INTO note_tags (path, tag, display) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}`,
          chunk.flatMap((t) => [notePath, t.tag, t.display]),
        );
      }
      await this.setIndexedMtime(notePath);
    });
  }

  removeFile(notePath: string): Promise<void> {
    return this.enqueue(() => this.deleteRows(notePath));
  }

  /** Drop every row under a folder (`unlinkDir`). */
  removePrefix(dirPath: string): Promise<void> {
    const like = escapeLike(dirPath) + '/%';
    return this.enqueue(async () => {
      await this.dataSource.query(`DELETE FROM note_tags WHERE path LIKE ? ESCAPE '\\'`, [like]);
      await this.dataSource.query(`DELETE FROM note_tags_meta WHERE path LIKE ? ESCAPE '\\'`, [like]);
    });
  }

  /**
   * Follow a file or folder move. Rows move with it, or are dropped when the
   * destination is not indexable (E2E folder, `.trash/`). A moved note is then
   * re-read so one coming from a non-indexed location gets indexed.
   */
  async renamePath(src: string, dest: string): Promise<void> {
    const like = escapeLike(src) + '/%';
    const keep = this.isIndexableLocation(dest);
    await this.enqueue(async () => {
      for (const table of ['note_tags', 'note_tags_meta']) {
        if (keep) {
          await this.dataSource.query(`UPDATE OR REPLACE ${table} SET path = ? WHERE path = ?`, [dest, src]);
          await this.dataSource.query(
            `UPDATE OR REPLACE ${table} SET path = ? || substr(path, ?) WHERE path LIKE ? ESCAPE '\\'`,
            [dest, src.length + 1, like],
          );
        } else {
          await this.dataSource.query(`DELETE FROM ${table} WHERE path = ?`, [src]);
          await this.dataSource.query(`DELETE FROM ${table} WHERE path LIKE ? ESCAPE '\\'`, [like]);
        }
      }
    });
    if (keep && this.isIndexable(dest)) {
      try {
        await this.indexFile(dest, await this.storage.read(dest));
      } catch {
        // Not readable (yet); the watcher `add` or the heal sweep catches up.
      }
    }
  }

  private async deleteRows(notePath: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM note_tags WHERE path = ?`, [notePath]);
    await this.dataSource.query(`DELETE FROM note_tags_meta WHERE path = ?`, [notePath]);
  }

  private async createMetaTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS note_tags_meta (
        path TEXT PRIMARY KEY,
        indexed_mtime INTEGER,
        parser_version INTEGER
      )
    `);
  }

  private async setIndexedMtime(notePath: string): Promise<void> {
    let mtime: number | null = Date.now();
    if (this.storage.stat) {
      try {
        mtime = (await this.storage.stat(notePath)).mtime.getTime();
      } catch {
        mtime = null; // the heal sweep re-checks NULL rows
      }
    }
    await this.dataSource.query(
      `INSERT INTO note_tags_meta (path, indexed_mtime, parser_version) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET indexed_mtime = excluded.indexed_mtime, parser_version = excluded.parser_version`,
      [notePath, mtime, TAG_PARSER_VERSION],
    );
  }

  private async needsFullScan(): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN parser_version IS NULL OR parser_version != ? THEN 1 ELSE 0 END) AS stale
         FROM note_tags_meta`,
      [TAG_PARSER_VERSION],
    );
    return Number(row.total) === 0 || Number(row.stale) > 0;
  }

  /** Rebuild the whole index: shared vault plus every personal folder. */
  async fullScan(): Promise<number> {
    this.logger.log('Starting full vault tag scan...');
    const t0 = Date.now();
    const paths = await this.collectIndexablePaths();
    await this.enqueue(async () => {
      await this.dataSource.query(`DELETE FROM note_tags`);
      await this.dataSource.query(`DELETE FROM note_tags_meta`);
    });
    let indexed = 0;
    for (const p of paths) {
      try {
        await this.indexFile(p, await this.storage.read(p));
        indexed++;
      } catch {
        // Skip unreadable files
      }
    }
    this.logger.log(`Full tag scan complete: ${indexed} files indexed in ${Date.now() - t0}ms`);
    return indexed;
  }

  /**
   * `storage.list('')` only walks the shared vault, so personal folders are
   * listed one by one from the `users` table. E2E folders are pruned before
   * any of their files is read.
   */
  private async collectIndexablePaths(): Promise<string[]> {
    const roots = [''];
    try {
      const users: { email: string }[] = await this.dataSource.query(`SELECT email FROM users`);
      for (const u of users) roots.push(personalRootFor(u.email));
    } catch {
      // No users table — shared vault only.
    }
    const out: string[] = [];
    const walk = (entries: FileEntry[]): void => {
      for (const entry of entries) {
        if (entry.type === 'directory') {
          if (entry.children && this.isIndexableLocation(entry.path)) walk(entry.children);
        } else if (this.isIndexable(entry.path)) {
          out.push(entry.path);
        }
      }
    };
    for (const root of roots) {
      try {
        walk(await this.storage.list(root));
      } catch {
        // Personal folder not created yet, or no personal storage configured.
      }
    }
    return out;
  }

  /**
   * Reconcile against disk: re-index rows whose disk mtime moved past
   * `indexed_mtime` (or is unknown), drop rows whose file is gone.
   */
  async healSweep(): Promise<{ reindexed: number; removed: number }> {
    let reindexed = 0;
    let removed = 0;
    if (!this.storage.stat) return { reindexed, removed };
    const rows: { path: string; indexed_mtime: number | null }[] = await this.dataSource.query(
      `SELECT path, indexed_mtime FROM note_tags_meta`,
    );
    for (const row of rows) {
      if (!this.isIndexable(row.path)) {
        await this.removeFile(row.path);
        removed++;
        continue;
      }
      try {
        const s = await this.storage.stat(row.path);
        if (row.indexed_mtime === null || s.mtime.getTime() > row.indexed_mtime) {
          try {
            await this.indexFile(row.path, await this.storage.read(row.path));
            reindexed++;
          } catch {
            // next sweep retries
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          await this.removeFile(row.path);
          removed++;
        }
      }
    }
    if (reindexed > 0 || removed > 0) {
      this.logger.log(`tag heal sweep: reindexed=${reindexed}, removed=${removed}`);
    }
    return { reindexed, removed };
  }

  // --- Queries ---

  /** Same predicate as backlinks / graph: own + shared paths, plus grants. */
  private async visibleFilter(userEmail?: string): Promise<(p: string) => boolean> {
    const grants = userEmail && this.visibility
      ? await this.visibility.visibleGrantSet(userEmail)
      : new Set<string>();
    return (p) =>
      this.isIndexableLocation(p) && (!userEmail || isVisibleTo(p, userEmail) || grants.has(p));
  }

  /**
   * Every tag carried by a note visible to the caller, with the number of
   * distinct visible notes carrying it or a nested child (`project/kalepin`
   * counts toward `project`). Sorted by key.
   */
  async listTags(userEmail?: string): Promise<TagCount[]> {
    const rows: { path: string; tag: string; display: string }[] = await this.dataSource.query(
      `SELECT path, tag, display FROM note_tags`,
    );
    const visible = await this.visibleFilter(userEmail);
    const agg = new Map<string, { paths: Set<string>; displays: Map<string, number> }>();
    for (const r of rows) {
      if (!visible(r.path)) continue;
      const keySegments = r.tag.split('/');
      const displaySegments = r.display.split('/');
      for (let i = 1; i <= keySegments.length; i++) {
        const key = keySegments.slice(0, i).join('/');
        const display = displaySegments.slice(0, i).join('/');
        let entry = agg.get(key);
        if (!entry) {
          entry = { paths: new Set(), displays: new Map() };
          agg.set(key, entry);
        }
        entry.paths.add(r.path);
        entry.displays.set(display, (entry.displays.get(display) ?? 0) + 1);
      }
    }
    return [...agg.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, e]) => ({ tag: pickDisplay(e.displays), count: e.paths.size }));
  }

  /**
   * Paths carrying every one of `tags` (each matched with its nested
   * children), without any visibility filtering — callers apply their own.
   */
  async pathsWithAllTags(tags: string[]): Promise<Set<string>> {
    const keys = [...new Set(tags.map(normalizeTagKey).filter(Boolean))];
    if (keys.length === 0) return new Set();
    let result: Set<string> | null = null;
    for (const key of keys) {
      const rows: { path: string }[] = await this.dataSource.query(
        `SELECT DISTINCT path FROM note_tags WHERE tag = ? OR tag LIKE ? ESCAPE '\\'`,
        [key, escapeLike(key) + '/%'],
      );
      const found = new Set(rows.map((r) => r.path));
      result = result ? new Set([...result].filter((p) => found.has(p))) : found;
      if (result.size === 0) break;
    }
    return result ?? new Set();
  }

  /** Visible notes carrying every one of `tags`, most recently modified first. */
  async notesForTags(tags: string[], userEmail?: string): Promise<TaggedNote[]> {
    const candidates = await this.pathsWithAllTags(tags);
    if (candidates.size === 0) return [];
    const visible = await this.visibleFilter(userEmail);
    const paths = [...candidates].filter(visible);
    if (paths.length === 0) return [];
    const meta: { path: string; indexed_mtime: number | null }[] = await this.dataSource.query(
      `SELECT path, indexed_mtime FROM note_tags_meta WHERE path IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(paths)],
    );
    const mtimes = new Map(meta.map((r) => [r.path, r.indexed_mtime]));
    return paths
      .map((p) => ({ path: p, mtime: mtimes.get(p) ?? null }))
      .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map(({ path: p, mtime }) => ({
        path: p,
        title: path.posix.basename(p, '.md'),
        modifiedAt: mtime === null ? null : new Date(mtime).toISOString(),
      }));
  }
}

/** Most frequent display form; ties go to the code-point-smallest. */
function pickDisplay(displays: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [display, count] of displays) {
    if (count > bestCount || (count === bestCount && display < best)) {
      best = display;
      bestCount = count;
    }
  }
  return best;
}
