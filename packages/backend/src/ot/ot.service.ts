import { Injectable, Inject, Logger, Optional, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import WebSocket from 'ws';
import { OTOperation } from '@kalepin/shared';
import { OTSessionManager } from './ot-session-manager';
import { diffToOps } from './text-diff';
import { OTOperationHistory } from '../entities';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { ChangeTrackingService } from '../changes';
import { DailyStatsService } from '../stats/daily-stats.service';
import { DocMentionService } from '../comments/doc-mention.service';
import { FileWatcherService } from '../files/file-watcher.service';

@Injectable()
export class OTService {
  private readonly logger = new Logger(OTService.name);
  readonly sessionManager = new OTSessionManager();
  private sessionCloseListeners: Array<(docId: string) => Promise<void> | void> = [];
  private opBroadcaster?: (docId: string, ops: OTOperation, revision: number) => void;

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @InjectRepository(OTOperationHistory) private readonly historyRepo: Repository<OTOperationHistory>,
    private readonly changeTracking: ChangeTrackingService,
    @Optional() private readonly dailyStatsService?: DailyStatsService,
    @Optional() @Inject(DocMentionService) private readonly docMentionService?: DocMentionService,
    @Optional() @Inject(forwardRef(() => FileWatcherService))
    private readonly fileWatcher?: FileWatcherService,
  ) {
    this.sessionManager.setFlushHandler(async (docId, content) => {
      this.logger.debug(`Flushing "${docId}" to storage, content length=${content.length}`);
      await this.storage.write(docId, content);
      // Internal-write channel: capture the post-write disk mtime so the
      // chokidar event for this same write is suppressed in FileWatcherService;
      // emit the content to in-process indexers so they skip the read+decrypt.
      if (this.fileWatcher && this.storage.stat) {
        try {
          const s = await this.storage.stat(docId);
          this.fileWatcher.markRecentInternalWrite(docId, s.mtime);
          this.fileWatcher.emitInternalWrite(docId, content);
        } catch (err) {
          this.logger.warn(
            `internal-write emit failed for "${docId}": ${(err as Error).message}`,
          );
        }
      }
    });

    this.sessionManager.setDiffCaptureHandler((docId, oldContent, newContent, userId) => {
      this.changeTracking.trackChange(docId, 'modified', oldContent, newContent, userId).catch((err) => {
        this.logger.error(`Failed to track change for "${docId}"`, err);
      });

      // Detect new doc mentions on save
      if (this.docMentionService && userId && docId.endsWith('.md')) {
        this.docMentionService.processDocSave(docId, oldContent, newContent, userId).catch((err) => {
          this.logger.error(`Failed to process doc mentions for "${docId}"`, err);
        });
      }
    });

    this.sessionManager.setSessionCloseHandler(async (docId) => {
      if (this.storage.commitAll) {
        await this.storage.commitAll(`Update ${docId}`);
      }
      for (const listener of this.sessionCloseListeners) {
        try {
          await listener(docId);
        } catch (err) {
          this.logger.error(`Session-close listener failed for "${docId}"`, err);
        }
      }
    });

    if (this.dailyStatsService) {
      this.sessionManager.setConcurrentEditHandler(() => {
        this.dailyStatsService!.trackOtConcurrentEdit();
      });
    }
  }

  /**
   * Register a callback fired when an OT session closes (after the final
   * flush). Used by SearchService to drain pending deferred embeddings on
   * session close. Multiple listeners are supported; failures are logged and
   * do not block other listeners.
   */
  addSessionCloseListener(handler: (docId: string) => Promise<void> | void): void {
    this.sessionCloseListeners.push(handler);
  }

  /** How ops the server applies itself (merged disk changes, server-side writes) reach a doc's clients. */
  setOpBroadcaster(broadcaster: (docId: string, ops: OTOperation, revision: number) => void): void {
    this.opBroadcaster = broadcaster;
  }

  /**
   * Join `ws` to the live session of `docId`, starting one from disk if
   * needed. Resolves to null when `docId` is not a note that can be edited
   * as text (a folder, a file that can't be read or decrypted, a binary
   * file): a session there would overwrite it on its first flush.
   */
  async openDocument(
    docId: string,
    ws: WebSocket,
    userId: number,
    email: string,
  ): Promise<{ content: string; revision: number } | null> {
    let content = '';
    if (!this.sessionManager.getSession(docId)) {
      try {
        content = await this.storage.read(docId);
      } catch (err) {
        // Only "no such file" means a new document. Any other failure (a
        // folder, no permission, a wrong key or a tampered envelope) is a
        // note we can't see: an empty session would overwrite it.
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          this.logger.warn(`Refusing to open "${docId}": ${(err as Error)?.message ?? err}`);
          return null;
        }
      }
      if (content.includes('\u0000')) {
        this.logger.warn(`Refusing to open "${docId}": binary content`);
        return null;
      }
    }
    this.logger.debug(`Opening "${docId}", disk content length=${content.length}`);

    const session = this.sessionManager.getOrCreateSession(docId, content);
    this.sessionManager.addClient(docId, ws, userId, email);

    this.logger.debug(`Opened "${docId}", session length=${session.content.length}, rev=${session.revision}`);
    return { content: session.content, revision: session.revision };
  }

  /**
   * Flush every open session at `path` or under `path/`, so the file a rename
   * is about to move holds the latest edits. Errors propagate: if live edits
   * can't be persisted, the rename should not go ahead.
   */
  async flushSessionsUnder(path: string): Promise<void> {
    for (const docId of this.sessionManager.sessionIdsAtOrUnder(path)) {
      await this.sessionManager.flushNow(docId);
    }
  }

  /**
   * Follow a rename of `src` to `dest` (file or folder): re-key every open
   * session so later flushes write to the new path instead of resurrecting the
   * old one. Sessions with no edits since the pre-move flush are reloaded from
   * disk, because the move may have rewritten the file (attachment paths).
   */
  async renameSessions(
    src: string,
    dest: string,
  ): Promise<Array<{ from: string; to: string; displaced: WebSocket[] }>> {
    const renamed: Array<{ from: string; to: string; displaced: WebSocket[] }> = [];
    for (const from of this.sessionManager.sessionIdsAtOrUnder(src)) {
      const to = dest + from.slice(src.length);
      // The move may have rewritten the file (attachment paths): merge that
      // into the session while it still has the id its clients use, so the
      // op reaches them and edits made since the pre-move flush are kept.
      await this.mergeExternalChange(from, to);
      const result = this.sessionManager.renameSession(from, to);
      if (!result) continue;
      renamed.push({ from, to, displaced: result.displaced });
    }
    return renamed;
  }

  /**
   * After `src` (file or folder) moved to `trashPath`: drop every session at
   * or under `src` so no later flush re-creates the file. `beforeMove` already
   * flushed them; edits that landed after that flush are written straight to
   * the trashed copy (no indexing, no change row — the note is in the trash).
   * Returns the dropped doc ids with their clients.
   */
  async discardSessionsUnder(
    src: string,
    trashPath: string,
  ): Promise<Array<{ docId: string; clients: WebSocket[] }>> {
    const dropped: Array<{ docId: string; clients: WebSocket[] }> = [];
    for (const docId of this.sessionManager.sessionIdsAtOrUnder(src)) {
      const result = this.sessionManager.discardSession(docId);
      if (!result) continue;
      if (result.unflushed !== null) {
        const dest = trashPath + docId.slice(src.length);
        try {
          await this.storage.write(dest, result.unflushed);
        } catch (err) {
          this.logger.error(`Failed to save late edits of trashed "${docId}"`, err);
        }
      }
      dropped.push({ docId, clients: result.clients });
    }
    return dropped;
  }

  /**
   * The file of an open note changed without going through its session
   * (another program, a write that raced the session's start, a trash
   * restore). Merge the change into the live content and send it to the
   * clients as an op, keeping their unsaved edits. `diskPath` is where the
   * file is now, when it moved under the session.
   */
  async mergeExternalChange(docId: string, diskPath: string = docId): Promise<void> {
    try {
      const result = await this.sessionManager.mergeFromDisk(docId, () => this.storage.read(diskPath));
      if (result) await this.publishServerOp(docId, result, 0);
    } catch (err) {
      this.logger.error(`Failed to merge the disk change of "${docId}"`, err);
    }
  }

  /**
   * A server-side write (MCP, REST) to a note with a live session: `edit`
   * gets the live content and returns the new one, and may throw (a stale
   * base hash, text not found). The change is applied as an op at the
   * current revision, so editors keep their pending edits, sent to the
   * clients and saved. Edits made before it are saved first, so the note's
   * history shows the write as a change of its own. Resolves to the new
   * content, or null when no session holds `docId` (write to disk then).
   */
  async applyServerEdit(docId: string, edit: (current: string) => string, userId?: number): Promise<string | null> {
    if (!this.sessionManager.getSession(docId)) return null;
    // A failed flush is logged and retried by the session manager.
    await this.sessionManager.flushNow(docId).catch(() => undefined);
    const session = this.sessionManager.getSession(docId);
    if (!session) return null;

    const before = session.content;
    const after = edit(before);
    const ops = diffToOps(before, after);
    if (ops) {
      const result = this.sessionManager.applyOperation(docId, ops, session.revision, userId ?? 0);
      if (result) await this.publishServerOp(docId, result, userId ?? 0);
    }
    await this.sessionManager.flushNow(docId).catch(() => undefined);
    return after;
  }

  /**
   * Record an op the server applied to a session itself, then send it to the
   * session's clients. The send waits for the history row, as for client
   * ops, so frames keep revision order.
   */
  private async publishServerOp(docId: string, result: { ops: OTOperation; revision: number }, userId: number): Promise<void> {
    try {
      await this.historyRepo.save({
        documentId: docId,
        revision: result.revision,
        operations: result.ops,
        userId,
      });
    } catch (err) {
      this.logger.error(`Failed to record server op for "${docId}"`, err);
    }
    this.opBroadcaster?.(docId, result.ops, result.revision);
  }

  /**
   * Apply a server-side text replacement to an open OT session.
   * Used for wikilink rewriting on file rename — the replacement goes through
   * the OT pipeline so concurrent user edits are handled correctly.
   * Returns the transformed ops and connected client WebSockets for broadcasting.
   */
  async applyServerReplacement(
    docId: string,
    oldText: string,
    newText: string,
  ): Promise<{ ops: OTOperation; revision: number; clients: WebSocket[] } | null> {
    const session = this.sessionManager.getSession(docId);
    if (!session) return null;

    const content = session.content;
    // Build an OT operation that replaces all occurrences of oldText with newText
    const components: OTOperation = [];
    let pos = 0;
    let idx = content.indexOf(oldText, pos);
    while (idx >= 0) {
      if (idx > pos) {
        components.push({ type: 'retain', count: idx - pos });
      }
      components.push({ type: 'delete', count: oldText.length });
      components.push({ type: 'insert', text: newText });
      pos = idx + oldText.length;
      idx = content.indexOf(oldText, pos);
    }
    // Retain the rest
    if (pos < content.length) {
      components.push({ type: 'retain', count: content.length - pos });
    }

    // If no replacements were found, nothing to do
    if (components.length === 0 || components.every((c) => c.type === 'retain')) {
      return null;
    }

    // Apply at the current revision (server is always up-to-date with itself)
    const result = this.sessionManager.applyOperation(docId, components, session.revision, 0);
    if (!result) return null;

    // Persist to history
    await this.historyRepo.save({
      documentId: docId,
      revision: result.revision,
      operations: result.ops,
      userId: 0, // system
    });

    const clientMap = this.sessionManager.getClients(docId);
    const clients = clientMap ? Array.from(clientMap.keys()) : [];

    return { ops: result.ops, revision: result.revision, clients };
  }

  async applyOperation(
    docId: string,
    ops: OTOperation,
    rev: number,
    userId: number,
  ): Promise<{ ops: OTOperation; revision: number } | null> {
    const result = this.sessionManager.applyOperation(docId, ops, rev, userId);

    if (result) {
      // Persist to history
      await this.historyRepo.save({
        documentId: docId,
        revision: result.revision,
        operations: result.ops,
        userId,
      });
    }

    return result;
  }
}
