import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { RenameCorrelator, RenameEvent } from '../storage/rename-correlator';
import { NoteChange, StarredItem } from '../entities';
import { ShareLinksService } from '../share-links/share-links.service';
import { GrantsService } from '../grants/grants.service';
import { FileWatcherService } from './file-watcher.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';

@Injectable()
export class RenameTrackingService implements OnModuleInit {
  private readonly logger = new Logger(RenameTrackingService.name);
  private correlator: RenameCorrelator;
  private recentlyRenamed = new Set<string>();

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly fileWatcher: FileWatcherService,
    @InjectRepository(NoteChange) private readonly changeRepo: Repository<NoteChange>,
    @InjectRepository(StarredItem) private readonly starRepo: Repository<StarredItem>,
    private readonly shareLinks: ShareLinksService,
    private readonly grants: GrantsService,
    private readonly docHandles: DocHandlesService,
  ) {
    this.correlator = new RenameCorrelator((p) => this.storage.read(p));
    this.correlator.setRenameHandler((rename) => this.handleRename(rename));
  }

  onModuleInit(): void {
    this.fileWatcher.onFileChange((event) => {
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
        // Wait longer than the rename correlator's 300ms debounce
        setTimeout(() => {
          if (this.recentlyRenamed.has(event.path)) {
            this.recentlyRenamed.delete(event.path);
            return;
          }
          this.shareLinks.deleteByPath(event.path).catch((err) => {
            this.logger.error(`Failed to delete share link for externally deleted "${event.path}"`, err);
          });
          this.grants.cascadeDelete(event.path).catch((err) => {
            this.logger.error(`Failed to revoke grants for externally deleted "${event.path}"`, err);
          });
          this.docHandles.tombstoneByPath(event.path).catch((err) => {
            this.logger.error(`Failed to tombstone doc handle for externally deleted "${event.path}"`, err);
          });
        }, 500);
      }
    });
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
