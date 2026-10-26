import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { FileChangeEvent } from '@kalepin/shared';

export type FileChangeCallback = (event: FileChangeEvent) => void;
export type InternalWriteCallback = (path: string, content: string) => void | Promise<void>;

const DEDUP_TTL_MS = 1000;
/** Must outlast chokidar latency + the rename-tracking 500ms unlink window. */
const SELF_CAUSED_TTL_MS = 10_000;

@Injectable()
export class FileWatcherService implements OnModuleInit {
  private readonly logger = new Logger(FileWatcherService.name);
  private sharedCallbacks: FileChangeCallback[] = [];
  private personalCallbacks: FileChangeCallback[] = [];
  private internalWriteCallbacks: InternalWriteCallback[] = [];
  /**
   * Dedup map keyed by virtual path. The mtime field is the disk mtime of the
   * file written by the internal-write code path, captured *after* the storage
   * write resolves. Chokidar events whose stat-derived mtime equals the stored
   * mtime are suppressed; events with a different mtime fall through (e.g., a
   * follow-up external write to the same path within the window).
   */
  private dedupMap = new Map<string, { mtime: number; expiresAt: number }>();
  /**
   * Paths (files or folder roots) Kalepin itself just changed on disk, so
   * rename tracking can tell them from changes made by another program.
   * `removed`: trashed, permanently deleted, or put back by a trash restore —
   * rename tracking ignores their events. `moved`: the source of
   * `FilesService.move` — still correlated (stars and history follow the
   * rename) but an unpaired unlink is not an external delete. Unlike
   * `dedupMap` this never suppresses events: search and the link index still
   * see the unlink.
   */
  private selfCaused = new Map<string, { kind: 'removed' | 'moved'; expiresAt: number }>();

  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  onModuleInit() {
    this.storage.watch((event) => {
      void this.dispatchChokidar(event, this.sharedCallbacks);
    });
    if (this.storage.watchPersonal) {
      this.storage.watchPersonal((event) => {
        void this.dispatchChokidar(event, this.personalCallbacks);
      });
    }
  }

  /** Subscribe to shared-vault chokidar events (deduplicated against internal writes). */
  onFileChange(callback: FileChangeCallback): void {
    this.sharedCallbacks.push(callback);
  }

  /** Subscribe to personal-root chokidar events (deduplicated against internal writes). */
  onPersonalChange(callback: FileChangeCallback): void {
    this.personalCallbacks.push(callback);
  }

  /**
   * Subscribe to internal-write events emitted by code paths that already have
   * the post-write content in memory (OT flush, FilesService writes). The
   * subscriber receives `(virtualPath, content)` and skips `storage.read`.
   */
  onInternalWrite(callback: InternalWriteCallback): void {
    this.internalWriteCallbacks.push(callback);
  }

  emitInternalWrite(virtualPath: string, content: string): void {
    for (const cb of this.internalWriteCallbacks) {
      try {
        const result = cb(virtualPath, content);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err: unknown) => {
            this.logger.warn(
              `internal-write subscriber failed for "${virtualPath}": ${(err as Error).message}`,
            );
          });
        }
      } catch (err) {
        this.logger.warn(
          `internal-write subscriber threw for "${virtualPath}": ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Record that an internal write produced this `(path, mtime)` so a chokidar
   * event with the same mtime within `DEDUP_TTL_MS` is suppressed. Caller is
   * responsible for invoking this AFTER the storage write resolves but BEFORE
   * yielding to the event loop, so the dedup entry races chokidar reliably.
   */
  markRecentInternalWrite(virtualPath: string, mtime: Date): void {
    this.pruneExpired();
    this.dedupMap.set(virtualPath, {
      mtime: mtime.getTime(),
      expiresAt: Date.now() + DEDUP_TTL_MS,
    });
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [path, entry] of this.dedupMap) {
      if (entry.expiresAt < now) this.dedupMap.delete(path);
    }
    for (const [path, entry] of this.selfCaused) {
      if (entry.expiresAt < now) this.selfCaused.delete(path);
    }
  }

  /**
   * Record that Kalepin is about to remove `virtualPath` (a file, or a folder
   * and everything under it), or to put it back from the trash. Call before
   * the storage operation so the chokidar event can't arrive first.
   */
  markSelfRemoved(virtualPath: string): void {
    this.markSelfCaused(virtualPath, 'removed');
  }

  /** Record that `FilesService.move` is about to move `virtualPath` away. */
  markSelfMoved(virtualPath: string): void {
    this.markSelfCaused(virtualPath, 'moved');
  }

  /** True when `virtualPath`, or a folder containing it, was marked removed. */
  isSelfRemoved(virtualPath: string): boolean {
    return this.selfCausedKind(virtualPath) === 'removed';
  }

  /** True when `virtualPath`, or a folder containing it, was marked at all. */
  isSelfCaused(virtualPath: string): boolean {
    return this.selfCausedKind(virtualPath) !== null;
  }

  private markSelfCaused(virtualPath: string, kind: 'removed' | 'moved'): void {
    this.pruneExpired();
    this.selfCaused.set(virtualPath, { kind, expiresAt: Date.now() + SELF_CAUSED_TTL_MS });
  }

  private selfCausedKind(virtualPath: string): 'removed' | 'moved' | null {
    const now = Date.now();
    let found: 'removed' | 'moved' | null = null;
    for (const [path, entry] of this.selfCaused) {
      if (entry.expiresAt < now) continue;
      if (virtualPath === path || virtualPath.startsWith(path + '/')) {
        if (entry.kind === 'removed') return 'removed';
        found = 'moved';
      }
    }
    return found;
  }

  private async dispatchChokidar(
    event: FileChangeEvent,
    callbacks: FileChangeCallback[],
  ): Promise<void> {
    const entry = this.dedupMap.get(event.path);
    if (entry && Date.now() <= entry.expiresAt) {
      // Atomic-write rename can surface as unlink+add on some platforms. The
      // unlink leg has no stats, so we drop it unconditionally while the dedup
      // entry is live; the follow-up add will be matched by mtime.
      if (event.event === 'unlink' || event.event === 'unlinkDir') {
        return;
      }
      try {
        if (this.storage.stat) {
          const s = await this.storage.stat(event.path);
          if (s.mtime.getTime() === entry.mtime) {
            // Match — drop it. Leave the entry in place; further chokidar
            // legs from the same atomic rename may still arrive within TTL.
            return;
          }
        }
      } catch {
        // File missing, permission error, etc — fall through.
      }
    } else if (entry) {
      this.dedupMap.delete(event.path);
    }
    for (const cb of callbacks) cb(event);
  }

  /** Test helper. */
  hasDedupEntry(virtualPath: string): boolean {
    const entry = this.dedupMap.get(virtualPath);
    return !!entry && Date.now() <= entry.expiresAt;
  }
}
