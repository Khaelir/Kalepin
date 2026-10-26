import { Injectable, Inject, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileChangeEvent } from '@kalepin/shared';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { RenameCorrelator, RenameEvent } from '../storage/rename-correlator';
import { NoteChange, StarredItem } from '../entities';
import { ShareLinksService } from '../share-links/share-links.service';
import { GrantsService } from '../grants/grants.service';
import { FileWatcherService } from './file-watcher.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { ChangeTrackingService } from '../changes/change-tracking.service';
import { isE2EPath } from '../crypto/encryption-predicates';

/** Longer than the rename correlator's 300ms debounce. */
const UNLINK_SETTLE_MS = 500;

@Injectable()
export class RenameTrackingService implements OnModuleInit {
  private readonly logger = new Logger(RenameTrackingService.name);
  private correlator: RenameCorrelator;
  /**
   * Personal-root events only need rename *detection* (so a rename isn't
   * recorded as a delete). Personal renames still don't re-path any rows,
   * as before.
   */
  private personalCorrelator: RenameCorrelator;
  private recentlyRenamed = new Set<string>();

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly fileWatcher: FileWatcherService,
    @InjectRepository(NoteChange) private readonly changeRepo: Repository<NoteChange>,
    @InjectRepository(StarredItem) private readonly starRepo: Repository<StarredItem>,
    private readonly shareLinks: ShareLinksService,
    private readonly grants: GrantsService,
    private readonly docHandles: DocHandlesService,
    @Optional() private readonly changeTracking?: ChangeTrackingService,
  ) {
    this.correlator = new RenameCorrelator((p) => this.storage.read(p));
    this.correlator.setRenameHandler((rename) => this.handleRename(rename));
    this.personalCorrelator = new RenameCorrelator((p) => this.storage.read(p));
    this.personalCorrelator.setRenameHandler(({ oldPath }) => {
      this.recentlyRenamed.add(oldPath);
    });
  }

  onModuleInit(): void {
    this.fileWatcher.onFileChange((event) => {
      // Kalepin's own trash / permanent delete / trash restore: the bookkeeping
      // is already done, and pairing the unlink (or add) with an unrelated
      // event would invent a rename. Search and links still get the event.
      if (this.fileWatcher.isSelfRemoved(event.path)) return;

      this.correlator.handleEvent(event);

      // External `add`: mint a handle if none exists. Idempotent — no-op when
      // the path already has a row (the common case during normal save flow,
      // where FilesService.createFile minted at write time).
      if (event.event === 'add' && event.path.endsWith('.md')) {
        this.docHandles.findOrCreateForPath(event.path).catch((err) => {
          this.logger.error(`Failed to mint doc handle for externally added "${event.path}"`, err);
        });
      }

      // External delete: clean up share links + grants, AND tombstone the
      // doc handle, but only after the rename-correlator window expires.
      // Otherwise a paired unlink+add (rename) would tombstone before the
      // correlator could update the path.
      if (event.event === 'unlink') {
        setTimeout(() => void this.handleSettledUnlink(event.path), UNLINK_SETTLE_MS);
      }
    });

    this.fileWatcher.onPersonalChange((event) => this.handlePersonalEvent(event));
  }

  /**
   * The correlator window has passed, so the unlink wasn't half of a rename.
   * Some platforms surface an atomic save as unlink + add of the same path: a
   * note that is back on disk keeps its share links, grants and handle.
   */
  private async handleSettledUnlink(path: string): Promise<void> {
    if (this.recentlyRenamed.has(path)) {
      this.recentlyRenamed.delete(path);
      return;
    }
    if (await this.isOnDisk(path)) return;
    this.shareLinks.deleteByPath(path).catch((err) => {
      this.logger.error(`Failed to delete share link for externally deleted "${path}"`, err);
    });
    this.grants.cascadeDelete(path).catch((err) => {
      this.logger.error(`Failed to revoke grants for externally deleted "${path}"`, err);
    });
    this.docHandles.tombstoneByPath(path).catch((err) => {
      this.logger.error(`Failed to tombstone doc handle for externally deleted "${path}"`, err);
    });
    void this.recordExternalDelete(path);
  }

  private async isOnDisk(path: string): Promise<boolean> {
    try {
      return await this.storage.exists(path);
    } catch {
      return false;
    }
  }

  private handlePersonalEvent(event: FileChangeEvent): void {
    if (this.fileWatcher.isSelfRemoved(event.path)) return;
    this.personalCorrelator.handleEvent(event);
    if (event.event !== 'unlink') return;
    setTimeout(() => {
      if (this.recentlyRenamed.has(event.path)) {
        this.recentlyRenamed.delete(event.path);
        return;
      }
      void this.recordExternalDelete(event.path);
    }, UNLINK_SETTLE_MS);
  }

  /**
   * A note vanished from disk without Kalepin doing it (Obsidian, a shell):
   * record it so the Changes panel and MCP `get_updates` report the delete.
   */
  private async recordExternalDelete(path: string): Promise<void> {
    if (!this.changeTracking || !path.endsWith('.md')) return;
    // E2E notes are managed client-side; their change rows are metadata-only.
    if (isE2EPath(path)) return;
    // Source of a FilesService.move whose destination this zone's watcher
    // can't see (shared ↔ personal), so the correlator never paired it.
    if (this.fileWatcher.isSelfCaused(path)) return;
    // Some platforms surface an atomic save as unlink + add of the same path.
    if (await this.isOnDisk(path)) return;
    try {
      await this.changeTracking.trackChange(path, 'deleted', null, null, null);
    } catch (err) {
      this.logger.error(`Failed to track external deletion of "${path}"`, err);
    }
  }

  private async handleRename(rename: RenameEvent): Promise<void> {
    const { oldPath, newPath } = rename;
    this.logger.debug(`Detected rename: "${oldPath}" → "${newPath}"`);
    this.recentlyRenamed.add(oldPath);

    try {
      // Update exact path matches in starred_items
      await this.starRepo
        .createQueryBuilder()
        .update()
        .set({ path: newPath })
        .where('path = :oldPath', { oldPath })
        .execute();

      // Update exact path matches in note_changes
      await this.changeRepo
        .createQueryBuilder()
        .update()
        .set({ path: newPath })
        .where('path = :oldPath', { oldPath })
        .execute();

      // Handle folder renames: update all paths with the old prefix
      await this.updatePathPrefix(oldPath, newPath);

      // Update share link paths
      await this.shareLinks.updatePath(oldPath, newPath);
      await this.shareLinks.updatePathPrefix(oldPath, newPath);

      // Update grant paths (exact + prefix in one call)
      await this.grants.cascadeRename(oldPath, newPath);

      // Mirror the same exact + prefix rewrite for doc handles so the existing
      // handle id follows the file (or every file under a renamed folder).
      await this.docHandles.updatePathByPath(oldPath, newPath);
      await this.docHandles.updatePathPrefix(oldPath, newPath);
    } catch (err) {
      this.logger.error(`Failed to update paths for rename "${oldPath}" → "${newPath}"`, err);
    }
  }

  private async updatePathPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    // Update starred_items where path starts with the old prefix + '/'
    const folderOldPrefix = oldPrefix + '/';
    const folderNewPrefix = newPrefix + '/';

    const starredItems = await this.starRepo
      .createQueryBuilder('s')
      .where('substr(s.path, 1, length(:prefix)) = :prefix', { prefix: folderOldPrefix })
      .getMany();

    for (const item of starredItems) {
      item.path = folderNewPrefix + item.path.slice(folderOldPrefix.length);
      await this.starRepo.save(item);
    }

    // Update note_changes where path starts with the old prefix + '/'
    const changes = await this.changeRepo
      .createQueryBuilder('c')
      .where('substr(c.path, 1, length(:prefix)) = :prefix', { prefix: folderOldPrefix })
      .getMany();

    for (const change of changes) {
      change.path = folderNewPrefix + change.path.slice(folderOldPrefix.length);
      await this.changeRepo.save(change);
    }
  }
}
