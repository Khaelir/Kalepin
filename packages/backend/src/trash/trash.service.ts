import {
  Injectable,
  Inject,
  Logger,
  Optional,
  OnModuleInit,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { randomBytes } from 'crypto';
import * as path from 'path';
import type { FileEntry } from '@kalepin/shared';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { TrashItem, TrashItemKind, StarredItem, NoteMeta } from '../entities';
import { FilesService, TrashHandler } from '../files/files.service';
import { FileWatcherService } from '../files/file-watcher.service';
import { ChangeTrackingService } from '../changes/change-tracking.service';
import { ShareLinksService } from '../share-links/share-links.service';
import { GrantsService } from '../grants/grants.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { isAdmin } from '../auth/admin.util';
import { isCanonicalPath, isTrashPath, isPersonalRootSegment } from '../auth/visibility';
import { isE2EPath } from '../crypto/encryption-predicates';
import { ownerOf, restoredName, trashPathFor, zoneOf, isSelfOrUnder } from './trash-paths';

export interface TrashItemView {
  id: string;
  name: string;
  originalPath: string;
  /** Parent folder of the original path; '' for the vault root. */
  originalFolder: string;
  kind: TrashItemKind;
  zone: 'shared' | 'personal';
  deletedByEmail: string;
  deletedAt: number;
  itemCount: number;
  canPurge: boolean;
}

export interface TrashActor {
  userId?: number;
  email?: string;
}

/** Upper bound on " (restored N)" attempts before giving up. */
const MAX_RESTORE_ATTEMPTS = 1000;

/**
 * Soft delete. Moves notes and folders into their zone's `.trash/<id>/`,
 * keeps a `trash_items` row, and restores or purges them. See the
 * `note-trash` design for why share links, grants, stars, PIN and doc handles
 * follow the item into the trash instead of staying at the original path.
 */
@Injectable()
export class TrashService implements OnModuleInit, TrashHandler {
  private readonly logger = new Logger(TrashService.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @InjectRepository(TrashItem) private readonly repo: Repository<TrashItem>,
    @InjectRepository(StarredItem) private readonly starRepo: Repository<StarredItem>,
    @InjectRepository(NoteMeta) private readonly metaRepo: Repository<NoteMeta>,
    private readonly files: FilesService,
    private readonly shareLinks: ShareLinksService,
    private readonly grants: GrantsService,
    private readonly docHandles: DocHandlesService,
    @Optional() private readonly fileWatcher?: FileWatcherService,
    @Optional() private readonly changeTracking?: ChangeTrackingService,
  ) {}

  onModuleInit(): void {
    this.files.setTrashHandler(this);
  }

  /**
   * Move `itemPath` (file or folder) to the trash. Callers check permissions
   * (FilesService.deleteFile / deleteDirectory). Resolves to the item id.
   */
  async trash(itemPath: string, actor: TrashActor): Promise<string> {
    if (!itemPath || itemPath === '/' || !isCanonicalPath(itemPath) || isPersonalRootSegment(itemPath)) {
      throw new BadRequestException('This folder cannot be deleted');
    }
    if (isTrashPath(itemPath)) throw new NotFoundException();
    if (isE2EPath(itemPath)) {
      throw new BadRequestException('End-to-end encrypted paths cannot be moved to the trash');
    }
    const entries = await this.listIfDirectory(itemPath);
    if (!entries && !(await this.storage.exists(itemPath))) {
      throw new NotFoundException('File not found');
    }
    const kind: TrashItemKind = entries ? 'folder' : 'file';
    const filePaths = entries ? flattenFiles(entries) : [itemPath];
    const id = randomBytes(8).toString('hex');
    const trashPath = trashPathFor(itemPath, id);

    await this.repo.insert({
      id,
      originalPath: itemPath,
      trashPath,
      kind,
      zone: zoneOf(itemPath),
      ownerEmail: ownerOf(itemPath),
      deletedByEmail: actor.email ? actor.email.toLowerCase() : 'system',
      deletedByUserId: actor.userId ?? null,
      deletedAt: Date.now(),
      itemCount: filePaths.length,
    });

    this.fileWatcher?.markSelfRemoved(itemPath);
    try {
      await this.files.relocateForTrash(itemPath, trashPath, id);
    } catch (err) {
      if (await this.storage.exists(itemPath)) {
        // Nothing moved: forget the row and surface the error.
        await this.repo.delete({ id });
        throw err;
      }
      // The item is in the trash; a bookkeeping step failed. Keep it
      // restorable rather than reporting a delete that did happen as failed.
      this.logger.error(`Trash bookkeeping failed for "${itemPath}"`, err);
    }
    await this.repathStarsAndPins(itemPath, trashPath);
    await this.docHandles.tombstoneAtOrUnder(trashPath);

    for (const p of filePaths) {
      if (!p.endsWith('.md')) continue;
      this.changeTracking?.trackChange(p, 'deleted', null, null, actor.userId ?? null).catch((err) => {
        this.logger.error(`Failed to track deletion for "${p}"`, err);
      });
    }
    return id;
  }

  /** Items `email` may see, newest first. Rows whose folder vanished are dropped. */
  async list(email: string): Promise<TrashItemView[]> {
    const viewer = email.toLowerCase();
    const rows = await this.visibleRows(viewer);
    const views: TrashItemView[] = [];
    for (const row of rows) {
      if (!this.hasExpectedTrashPath(row)) continue;
      if (!(await this.storage.exists(row.trashPath))) {
        await this.forget(row);
        continue;
      }
      views.push(this.toView(row, viewer));
    }
    return views;
  }

  /** Put an item back at its original path (or "Name (restored).md"). */
  async restore(id: string, actor: TrashActor & { email: string }): Promise<{ id: string; path: string; kind: TrashItemKind }> {
    const viewer = actor.email.toLowerCase();
    const row = await this.findVisible(id, viewer);
    await this.files.assertWritable(row.originalPath, viewer);
    this.assertExpectedTrashPath(row);
    if (!(await this.storage.exists(row.trashPath))) {
      await this.forget(row);
      throw new NotFoundException('Trash item not found');
    }

    const dest = await this.pickRestorePath(row);
    this.fileWatcher?.markSelfRemoved(dest);
    // dest is free on disk, so rows still pointing there belong to a note
    // deleted earlier; the restored item's own rows replace them.
    await this.clearStaleRows(dest);
    await this.files.relocateFromTrash(row.trashPath, dest);
    await this.repathStarsAndPins(row.trashPath, dest);
    await this.docHandles.untombstoneAtOrUnder(dest);
    await this.repo.delete({ id: row.id });
    await this.removeItemFolder(row);

    const entries = row.kind === 'folder' ? await this.listIfDirectory(dest) : null;
    const filePaths = entries ? flattenFiles(entries) : [dest];
    for (const p of filePaths) {
      if (p.endsWith('.md')) await this.announceRestored(p, actor.userId ?? null);
    }
    return { id: row.id, path: dest, kind: row.kind };
  }

  /** Delete an item for good. The deleter, an admin, or the personal owner. */
  async purge(id: string, email: string): Promise<void> {
    const viewer = email.toLowerCase();
    const row = await this.findVisible(id, viewer);
    if (!this.canPurge(row, viewer)) {
      throw new ForbiddenException('Only the person who deleted this item or an admin can delete it permanently');
    }
    await this.purgeRow(row);
  }

  /** Purge every visible item `email` may purge. Returns how many. */
  async emptyTrash(email: string): Promise<number> {
    const viewer = email.toLowerCase();
    let purged = 0;
    for (const row of await this.visibleRows(viewer)) {
      if (!this.canPurge(row, viewer)) continue;
      await this.purgeRow(row);
      purged++;
    }
    return purged;
  }

  /** Retention: purge items deleted before `cutoffMs`, in every zone. */
  async purgeOlderThan(cutoffMs: number): Promise<number> {
    const rows = await this.repo.find({ where: { deletedAt: LessThan(cutoffMs) } });
    let purged = 0;
    for (const row of rows) {
      try {
        await this.purgeRow(row);
        purged++;
      } catch (err) {
        this.logger.error(`Retention purge failed for trash item ${row.id}`, err);
      }
    }
    return purged;
  }

  private canSee(row: TrashItem, viewer: string): boolean {
    return row.zone === 'shared' || row.ownerEmail === viewer;
  }

  private canPurge(row: TrashItem, viewer: string): boolean {
    if (row.deletedByEmail === viewer || isAdmin(viewer)) return true;
    return row.zone === 'personal' && row.ownerEmail === viewer;
  }

  private async visibleRows(viewer: string): Promise<TrashItem[]> {
    return this.repo
      .createQueryBuilder('t')
      .where("t.zone = 'shared' OR t.ownerEmail = :viewer", { viewer })
      .orderBy('t.deletedAt', 'DESC')
      .getMany();
  }

  /** Another user's personal item is indistinguishable from a missing one. */
  private async findVisible(id: string, viewer: string): Promise<TrashItem> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row || !this.canSee(row, viewer)) throw new NotFoundException('Trash item not found');
    return row;
  }

  private toView(row: TrashItem, viewer: string): TrashItemView {
    const folder = path.posix.dirname(row.originalPath);
    return {
      id: row.id,
      name: path.posix.basename(row.originalPath),
      originalPath: row.originalPath,
      originalFolder: folder === '.' ? '' : folder,
      kind: row.kind,
      zone: row.zone,
      deletedByEmail: row.deletedByEmail,
      deletedAt: row.deletedAt,
      itemCount: row.itemCount,
      canPurge: this.canPurge(row, viewer),
    };
  }

  private async pickRestorePath(row: TrashItem): Promise<string> {
    if (!(await this.storage.exists(row.originalPath))) return row.originalPath;
    for (let n = 1; n <= MAX_RESTORE_ATTEMPTS; n++) {
      const candidate = restoredName(row.originalPath, row.kind, n);
      if (!(await this.storage.exists(candidate))) return candidate;
    }
    throw new ConflictException(`No free name to restore "${row.originalPath}"`);
  }

  private async purgeRow(row: TrashItem): Promise<void> {
    this.assertExpectedTrashPath(row);
    await this.removeItemFolder(row);
    await this.forget(row);
  }

  /**
   * Every delete, move or cleanup keyed on `row.trashPath` is gated on the path
   * being exactly what `trash()` wrote, so a corrupted row can never aim a
   * recursive delete (or a grant / share-link cleanup) at a live note or folder.
   */
  private hasExpectedTrashPath(row: TrashItem): boolean {
    if (row.trashPath === trashPathFor(row.originalPath, row.id)) return true;
    this.logger.error(`Trash item ${row.id} has an unexpected trash path "${row.trashPath}"; leaving it alone`);
    return false;
  }

  private assertExpectedTrashPath(row: TrashItem): void {
    if (!this.hasExpectedTrashPath(row)) throw new InternalServerErrorException('Trash item is corrupted');
  }

  /** Delete `<trash root>/<id>/` (whatever is left in it). */
  private async removeItemFolder(row: TrashItem): Promise<void> {
    const itemFolder = path.posix.dirname(row.trashPath);
    if (!(await this.storage.exists(itemFolder))) return;
    try {
      await this.storage.delete(itemFolder);
    } catch (err) {
      this.logger.warn(`Failed to remove trash folder "${itemFolder}": ${(err as Error).message}`);
    }
  }

  /** Today's permanent-delete cleanup, applied at the trash path, then drop the row. */
  private async forget(row: TrashItem): Promise<void> {
    this.assertExpectedTrashPath(row);
    await this.shareLinks.deleteByPath(row.trashPath);
    await this.shareLinks.deleteByPathPrefix(row.trashPath);
    await this.grants.cascadeDelete(row.trashPath);
    await this.clearStaleRows(row.trashPath);
    // Doc handles stay tombstoned at the trash path: rows are never deleted.
    await this.repo.delete({ id: row.id });
  }

  /** Delete star and PIN rows at or under `p`. */
  private async clearStaleRows(p: string): Promise<void> {
    const stars = await this.rowsAtOrUnder(this.starRepo, 's', p);
    if (stars.length > 0) await this.starRepo.remove(stars);
    const metas = await this.rowsAtOrUnder(this.metaRepo, 'm', p);
    if (metas.length > 0) await this.metaRepo.remove(metas);
  }

  /** Stars and PIN rows follow the item; FilesService re-paths the rest. */
  private async repathStarsAndPins(src: string, dest: string): Promise<void> {
    for (const star of await this.rowsAtOrUnder(this.starRepo, 's', src)) {
      star.path = dest + star.path.slice(src.length);
      await this.starRepo.save(star);
    }
    // note_meta is keyed by path: re-key with an UPDATE rather than save().
    for (const meta of await this.rowsAtOrUnder(this.metaRepo, 'm', src)) {
      const next = dest + meta.path.slice(src.length);
      await this.metaRepo.delete({ path: next });
      await this.metaRepo
        .createQueryBuilder()
        .update()
        .set({ path: next })
        .where('path = :path', { path: meta.path })
        .execute();
    }
  }

  private async rowsAtOrUnder<T extends { path: string }>(
    repo: Repository<T>,
    alias: string,
    p: string,
  ): Promise<T[]> {
    const rows = await repo
      .createQueryBuilder(alias)
      .where(`${alias}.path = :p OR substr(${alias}.path, 1, length(:prefix)) = :prefix`, { p, prefix: `${p}/` })
      .getMany();
    return rows.filter((r) => isSelfOrUnder(r.path, p));
  }

  /** History, search, links and open sessions pick the restored note up. */
  private async announceRestored(notePath: string, userId: number | null): Promise<void> {
    let content: string;
    try {
      content = await this.storage.read(notePath);
    } catch (err) {
      this.logger.warn(`Restored note "${notePath}" unreadable: ${(err as Error).message}`);
      return;
    }
    this.changeTracking?.trackChange(notePath, 'created', null, content, userId).catch((err) => {
      this.logger.error(`Failed to track restore of "${notePath}"`, err);
    });
    this.fileWatcher?.emitInternalWrite(notePath, content);
    this.files.emit('file:written', { path: notePath });
  }

  private async listIfDirectory(p: string): Promise<FileEntry[] | null> {
    try {
      return await this.storage.list(p);
    } catch {
      return null;
    }
  }
}

function flattenFiles(entries: FileEntry[]): string[] {
  const out: string[] = [];
  const walk = (list: FileEntry[]) => {
    for (const e of list) {
      if (e.type === 'directory') walk(e.children ?? []);
      else out.push(e.path);
    }
  };
  walk(entries);
  return out;
}
