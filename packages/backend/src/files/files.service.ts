import { Injectable, Inject, Logger, Optional, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { ChangeTrackingService } from '../changes';
import { DailyStatsService } from '../stats/daily-stats.service';
import { ShareLinksService } from '../share-links/share-links.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import type { LinkIndexService } from '../links/link-index.service';
import { FileWatcherService } from './file-watcher.service';
import { FileEntry } from '@kalepin/shared';
import {
  PERSONAL_PREFIX,
  isPersonalRootSegment,
  isUnderPersonalRoot,
  isVisibleTo,
  personalRootFor,
} from '../auth/visibility';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { GrantsService } from '../grants/grants.service';
import { DocumentGrant } from '../entities/document-grant.entity';
import { isE2EPath } from '../crypto/encryption-predicates';
import * as path from 'path';

@Injectable()
export class FilesService extends EventEmitter {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Optional() private readonly changeTracking?: ChangeTrackingService,
    @Optional() @Inject('LINK_INDEX_SERVICE') private readonly linkIndex?: LinkIndexService,
    @Optional() private readonly dailyStatsService?: DailyStatsService,
    @Optional() private readonly shareLinks?: ShareLinksService,
    @Optional() private readonly attachments?: AttachmentsService,
    @Optional() private readonly visibility?: GrantAwareVisibility,
    @Optional() private readonly grants?: GrantsService,
    @Optional() private readonly fileWatcher?: FileWatcherService,
    @Optional() private readonly docHandles?: DocHandlesService,
  ) {
    super();
  }

  /**
   * After a successful storage write, capture the resolved disk mtime,
   * mark the chokidar dedup window, and notify in-process indexers with the
   * in-memory content so they skip the redundant `storage.read` + decrypt.
   * Non-throwing: failures are logged and the write is considered done.
   */
  private async announceInternalWrite(virtualPath: string, content: string): Promise<void> {
    if (!this.fileWatcher) return;
    if (!this.storage.stat) return;
    try {
      const s = await this.storage.stat(virtualPath);
      this.fileWatcher.markRecentInternalWrite(virtualPath, s.mtime);
      this.fileWatcher.emitInternalWrite(virtualPath, content);
    } catch (err) {
      this.logger.warn(
        `internal-write emit failed for "${virtualPath}": ${(err as Error).message}`,
      );
    }
  }

  private async assertReadable(filePath: string, userEmail: string): Promise<void> {
    if (this.visibility) return this.visibility.assertReadableBy(filePath, userEmail);
    if (!isVisibleTo(filePath, userEmail)) throw new NotFoundException();
  }

  private async assertWritable(filePath: string, userEmail: string): Promise<void> {
    if (this.visibility) return this.visibility.assertWritableBy(filePath, userEmail);
    if (!isVisibleTo(filePath, userEmail)) throw new NotFoundException();
  }

  /** MD5 hash truncated to 8 hex chars — used for optimistic concurrency on MCP writes. */
  computeContentHash(content: string): string {
    return createHash('md5').update(content).digest('hex').slice(0, 8);
  }

  /** Throws ConflictException if baseHash doesn't match the current content hash. */
  validateBaseHash(currentContent: string, baseHash?: string): void {
    if (!baseHash) return;
    const currentHash = this.computeContentHash(currentContent);
    if (currentHash !== baseHash) {
      throw new ConflictException(
        `Content has changed since you last read it (expected hash ${baseHash}, current ${currentHash}). Re-read the note and retry.`,
      );
    }
  }

  async createFile(filePath: string, content: string = '', userId?: number, baseHash?: string, userEmail?: string): Promise<void> {
    if (!filePath.endsWith('.md')) {
      filePath = filePath + '.md';
    }
    if (userEmail) await this.assertWritable(filePath, userEmail);

    // Read existing content for change tracking and base_hash validation
    let oldContent: string | null = null;
    let isNew = true;
    try {
      oldContent = await this.storage.read(filePath);
      isNew = false;
    } catch {
      // File doesn't exist yet — it's a create
    }

    if (!isNew && oldContent !== null) {
      this.validateBaseHash(oldContent, baseHash);
    }

    await this.storage.write(filePath, content);
    await this.announceInternalWrite(filePath, content);
    this.emit('file:written', { path: filePath });

    // Mint a stable handle for the new path. Idempotent — re-create of an
    // existing path returns the existing id and reactivates if tombstoned.
    if (this.docHandles) {
      this.docHandles.findOrCreateForPath(filePath).catch((err) => {
        this.logger.error(`Failed to mint doc handle for "${filePath}"`, err);
      });
    }

    // Track the change asynchronously
    if (this.changeTracking) {
      const action = isNew ? 'created' : 'modified';
      this.changeTracking.trackChange(filePath, action, oldContent, content, userId).catch((err) => {
        this.logger.error(`Failed to track change for "${filePath}"`, err);
      });
    }

    if (this.dailyStatsService) {
      if (isNew) this.dailyStatsService.trackNoteCreated();
      else this.dailyStatsService.trackNoteEdited();
    }
  }

  async patchFile(filePath: string, oldText: string, newText: string, baseHash?: string, userEmail?: string): Promise<void> {
    if (userEmail) await this.assertWritable(filePath, userEmail);
    const content = await this.readFile(filePath, userEmail);
    this.validateBaseHash(content, baseHash);

    const count = content.split(oldText).length - 1;
    if (count === 0) {
      throw new NotFoundException(
        `Text not found in "${filePath}". The document may have changed — re-read and retry with the correct text.`,
      );
    }
    if (count > 1) {
      throw new ConflictException(
        `Found ${count} matches for the provided text in "${filePath}". Include more surrounding context to make the match unique.`,
      );
    }

    const updated = content.replace(oldText, newText);
    await this.storage.write(filePath, updated);
    await this.announceInternalWrite(filePath, updated);
    this.emit('file:written', { path: filePath });

    if (this.changeTracking) {
      this.changeTracking.trackChange(filePath, 'modified', content, updated).catch((err) => {
        this.logger.error(`Failed to track change for "${filePath}"`, err);
      });
    }

    this.dailyStatsService?.trackNoteEdited();
  }

  async appendToFile(filePath: string, content: string, separator: string = '\n\n', baseHash?: string, userEmail?: string): Promise<void> {
    if (userEmail) await this.assertWritable(filePath, userEmail);
    let existing: string;
    try {
      existing = await this.storage.read(filePath);
    } catch {
      throw new NotFoundException(
        `Note "${filePath}" not found. Use create_note to create a new one.`,
      );
    }

    this.validateBaseHash(existing, baseHash);

    const updated = existing + separator + content;
    await this.storage.write(filePath, updated);
    await this.announceInternalWrite(filePath, updated);
    this.emit('file:written', { path: filePath });

    if (this.changeTracking) {
      this.changeTracking.trackChange(filePath, 'modified', existing, updated).catch((err) => {
        this.logger.error(`Failed to track change for "${filePath}"`, err);
      });
    }

    this.dailyStatsService?.trackNoteEdited();
  }

  async readFile(filePath: string, userEmail?: string): Promise<string> {
    if (userEmail) await this.assertReadable(filePath, userEmail);
    // E2E paths must go through `/api/files/secure/read` so the client gets
    // the raw envelope (not corrupted UTF-8 from the encrypted blob). This
    // also prevents the legacy text endpoint from leaking the AAD or any
    // header bytes that happen to round-trip cleanly.
    if (isE2EPath(filePath)) {
      throw new BadRequestException('use /api/files/secure/read for end-to-end encrypted paths');
    }
    try {
      return await this.storage.read(filePath);
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  async deleteFile(filePath: string, userId?: number, userEmail?: string): Promise<void> {
    if (userEmail) {
      await this.assertWritable(filePath, userEmail);
      if (isPersonalRootSegment(filePath)) {
        throw new BadRequestException('Personal folder cannot be deleted');
      }
    }
    await this.storage.delete(filePath);
    if (this.grants) {
      await this.grants.cascadeDelete(filePath);
    }
    // Also delete sidecar if it exists
    const sidecarPath = this.sidecarPath(filePath);
    if (await this.storage.exists(sidecarPath)) {
      await this.storage.delete(sidecarPath);
    }

    // Track the deletion asynchronously
    if (this.changeTracking) {
      this.changeTracking.trackChange(filePath, 'deleted', null, null, userId).catch((err) => {
        this.logger.error(`Failed to track deletion for "${filePath}"`, err);
      });
    }

    // Remove share link
    if (this.shareLinks) {
      this.shareLinks.deleteByPath(filePath).catch((err) => {
        this.logger.error(`Failed to delete share link for "${filePath}"`, err);
      });
    }

    // Tombstone the doc handle so stale internal URLs render the "no longer
    // exists" card. Best-effort — disk delete is the source of truth.
    if (this.docHandles) {
      this.docHandles.tombstoneByPath(filePath).catch((err) => {
        this.logger.error(`Failed to tombstone doc handle for "${filePath}"`, err);
      });
    }
  }

  async createDirectory(dirPath: string, userEmail?: string): Promise<void> {
    if (userEmail) {
      await this.assertWritable(dirPath, userEmail);
      // The shared vault MUST NOT contain a top-level "_users" directory; that path
      // is reserved for the personal-folder virtual namespace.
      if (dirPath === '_users' || dirPath === PERSONAL_PREFIX || dirPath.startsWith(PERSONAL_PREFIX)) {
        if (dirPath === '_users' || dirPath === PERSONAL_PREFIX || isPersonalRootSegment(dirPath)) {
          throw new BadRequestException('"_users" is reserved');
        }
      }
    }
    // Write a placeholder to ensure directory exists, then remove it
    const placeholder = path.join(dirPath, '.gitkeep');
    await this.storage.write(placeholder, '');
    await this.storage.delete(placeholder);
  }

  /**
   * Unified create — picks "Untitled note" / "New folder" when name is omitted,
   * resolves collisions by appending " 2", " 3", … (the leaf segment, before extension).
   */
  async createItem(
    kind: 'note' | 'folder',
    parentPath: string,
    name: string | undefined,
    userId?: number,
    userEmail?: string,
  ): Promise<{ path: string }> {
    const cleanParent = (parentPath || '').replace(/^\/+|\/+$/g, '');
    if (userEmail) await this.assertWritable(cleanParent, userEmail);
    const fallback = kind === 'note' ? 'Untitled note' : 'New folder';
    const base = ((name ?? '').trim() || fallback).replace(/[\\/]/g, '-');
    const ext = kind === 'note' ? '.md' : '';

    let i = 1;
    let leaf = base;
    while (true) {
      const fileName = leaf + ext;
      const fullPath = cleanParent ? `${cleanParent}/${fileName}` : fileName;
      if (!(await this.storage.exists(fullPath))) {
        if (kind === 'note') {
          await this.createFile(fullPath, '', userId, undefined, userEmail);
        } else {
          await this.createDirectory(fullPath, userEmail);
        }
        return { path: fullPath };
      }
      i++;
      leaf = `${base} ${i}`;
    }
  }

  async deleteDirectory(dirPath: string, userEmail?: string): Promise<void> {
    if (userEmail) {
      await this.assertWritable(dirPath, userEmail);
      if (isPersonalRootSegment(dirPath)) {
        throw new BadRequestException('Personal folder cannot be deleted');
      }
    }
    await this.storage.delete(dirPath);
    if (this.grants) {
      await this.grants.cascadeDelete(dirPath);
    }
  }

  async move(src: string, dest: string, userEmail?: string): Promise<void> {
    if (userEmail) {
      // Both ends gated; non-owner sees 404 for either side.
      await this.assertWritable(src, userEmail);
      await this.assertWritable(dest, userEmail);
      if (isPersonalRootSegment(src)) {
        throw new BadRequestException('Personal folder cannot be renamed');
      }
      if (dest === '_users' || dest === PERSONAL_PREFIX || isPersonalRootSegment(dest)) {
        throw new BadRequestException('"_users" is reserved');
      }
    }
    await this.storage.move(src, dest);
    // Move sidecar file too
    const srcSidecar = this.sidecarPath(src);
    const destSidecar = this.sidecarPath(dest);
    if (await this.storage.exists(srcSidecar)) {
      await this.storage.move(srcSidecar, destSidecar);
    }
    // Rewrite links across the vault pointing to the old path
    if (dest.endsWith('.md') && this.linkIndex) {
      await this.linkIndex.rewriteLinksOnRename(src, dest);
    }
    // Rewrite _attachments/ relative paths in .md files
    if (dest.endsWith('.md')) {
      await this.rewriteAttachmentPaths(src, dest);
      // When the move crosses the shared/personal boundary, copy referenced
      // attachment files into the destination namespace so the doc still renders.
      await this.copyAttachmentsAcrossBoundary(src, dest);
    }
    // Update share link path (file or folder rename)
    if (this.shareLinks) {
      await this.shareLinks.updatePath(src, dest);
      await this.shareLinks.updatePathPrefix(src, dest);
    }
    // Update grants on the moved path or its subtree.
    if (this.grants) {
      await this.grants.cascadeRename(src, dest);
    }
    // Mirror the same exact + prefix rewrite for doc handles so internal
    // /doc/<id> URLs survive the rename.
    if (this.docHandles) {
      await this.docHandles.updatePathByPath(src, dest);
      await this.docHandles.updatePathPrefix(src, dest);
    }
  }

  private async copyAttachmentsAcrossBoundary(src: string, dest: string): Promise<void> {
    if (!this.attachments) return;
    const srcPersonal = isUnderPersonalRoot(src);
    const destPersonal = isUnderPersonalRoot(dest);
    if (srcPersonal === destPersonal) return; // same namespace, nothing to copy
    let content: string;
    try {
      content = await this.storage.read(dest);
    } catch {
      return;
    }
    const referenced = new Set<string>();
    const regex = /_attachments\/([^\s)]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      referenced.add(match[1]);
    }
    if (referenced.size === 0) return;

    const srcEmail = srcPersonal ? src.slice(PERSONAL_PREFIX.length).split('/')[0] : undefined;
    const destEmail = destPersonal ? dest.slice(PERSONAL_PREFIX.length).split('/')[0] : undefined;
    const fromNs = srcEmail ? { kind: 'personal' as const, email: srcEmail } : { kind: 'shared' as const };
    const toNs = destEmail ? { kind: 'personal' as const, email: destEmail } : { kind: 'shared' as const };

    for (const name of referenced) {
      try {
        await this.attachments.copyBetweenNamespaces(name, fromNs, toNs);
      } catch (err) {
        this.logger.warn(`Failed to copy attachment ${name} across boundary: ${(err as Error).message}`);
      }
    }
  }

  private async rewriteAttachmentPaths(
    src: string,
    dest: string,
  ): Promise<void> {
    try {
      const content = await this.storage.read(dest);
      const srcDir = path.dirname(src);
      const destDir = path.dirname(dest);
      if (srcDir === destDir) return;

      const oldPrefix = path.posix.join(
        path.posix.relative(srcDir, '.'),
        '_attachments',
      );
      const newPrefix = path.posix.join(
        path.posix.relative(destDir, '.'),
        '_attachments',
      );

      if (oldPrefix === newPrefix) return;

      const updated = content.replaceAll(oldPrefix, newPrefix);
      if (updated !== content) {
        await this.storage.write(dest, updated);
      }
    } catch {
      // File might not be readable, skip silently
    }
  }

  async listTree(dir: string = '', userEmail?: string): Promise<FileEntry[]> {
    // No user context — preserve legacy behavior (system / pre-Phase-13 callers).
    if (!userEmail) return this.storage.list(dir);

    if (dir === '_users' || dir === PERSONAL_PREFIX) {
      // Listing the bare _users directory exposes nothing (no user knows of others).
      return [];
    }

    if (isUnderPersonalRoot(dir)) {
      const root = personalRootFor(userEmail);
      if (dir !== root && !dir.startsWith(root + '/')) {
        // Foreign personal subtree — existence is non-observable.
        throw new NotFoundException();
      }
      return this.storage.list(dir);
    }

    if (dir === '' || dir === '/') {
      const sharedEntries = (await this.storage.list(dir))
        .filter((e) => e.path !== '_users' && !e.path.startsWith(PERSONAL_PREFIX));
      // Union the requester's own personal subtree if it exists.
      const personalRoot = personalRootFor(userEmail);
      let personalEntries: FileEntry[] = [];
      try {
        const ownTree = await this.storage.list(personalRoot);
        if (ownTree.length > 0 || (await this.storage.exists(personalRoot))) {
          personalEntries = [{
            name: '_users',
            path: '_users',
            type: 'directory',
            children: [{
              name: userEmail,
              path: personalRoot,
              type: 'directory',
              children: ownTree,
            }],
          }];
        }
      } catch {
        // No personal folder yet — surface nothing.
      }
      const sharedWithMe = await this.buildSharedWithMeRoot(userEmail);
      return [
        ...personalEntries,
        ...(sharedWithMe ? [sharedWithMe] : []),
        ...sharedEntries,
      ];
    }

    return (await this.storage.list(dir)).filter((e) => isVisibleTo(e.path, userEmail));
  }

  /**
   * Synthesise a `_shared_with_me/` virtual root by listing the user's active
   * grants, grouping by grantor, and exposing each grantee path as a leaf.
   * Returns null when the user has no active grants.
   */
  /**
   * Returns the user's active grants whose target file still exists on disk.
   * Grants pointing at a missing path are dropped from the result and
   * asynchronously revoked (best-effort GC). Used by `_shared_with_me` surfaces
   * — the file-tree virtual root and the `/api/files/shared-with-me` endpoint —
   * to avoid surfacing dangling rows from before the rename/delete hooks shipped.
   */
  async listLiveGrantsForGrantee(userEmail: string): Promise<DocumentGrant[]> {
    if (!this.grants) return [];
    const grants = await this.grants.listForGrantee(userEmail);
    if (grants.length === 0) return [];
    const presence = await Promise.all(
      grants.map((g) => this.storage.exists(g.path).catch(() => false)),
    );
    const live = grants.filter((_, i) => presence[i]);
    const dangling = grants.filter((_, i) => !presence[i]);
    for (const g of dangling) {
      this.grants.cascadeDelete(g.path).catch((err) => {
        this.logger.error(`Failed to GC dangling grant on "${g.path}"`, err);
      });
    }
    return live;
  }

  private async buildSharedWithMeRoot(userEmail: string): Promise<FileEntry | null> {
    const live = await this.listLiveGrantsForGrantee(userEmail);
    if (live.length === 0) return null;
    const byGrantor = new Map<string, typeof live>();
    for (const g of live) {
      const list = byGrantor.get(g.grantorEmail) ?? [];
      list.push(g);
      byGrantor.set(g.grantorEmail, list);
    }
    const groups: FileEntry[] = [];
    for (const [grantor, items] of byGrantor) {
      const groupPath = `_shared_with_me/${grantor}`;
      groups.push({
        name: grantor,
        path: groupPath,
        type: 'directory',
        children: items.map((g) => {
          const leaf = g.path.split('/').pop() ?? g.path;
          return {
            name: leaf,
            path: g.path,
            type: 'file' as const,
          };
        }),
      });
    }
    return {
      name: '_shared_with_me',
      path: '_shared_with_me',
      type: 'directory',
      children: groups,
    };
  }

  private sidecarPath(filePath: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    return path.join(dir, `.${base}.collab`);
  }
}
