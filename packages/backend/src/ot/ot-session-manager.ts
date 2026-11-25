import { Logger } from '@nestjs/common';
import { OTOperation } from '@kalepin/shared';
import { apply, transform } from './ot-engine';
import { diffToOps } from './text-diff';
import WebSocket from 'ws';

interface ClientInfo {
  ws: WebSocket;
  userId: number;
  email: string;
}

interface DocumentSession {
  docId: string;
  content: string;
  revision: number;
  /**
   * The latest ops, oldest first: `history[i]` took the doc from revision
   * `historyStart + i` to the next. Older ops are trimmed, and a reset
   * starts over, so `history[0]` is rarely revision 0.
   */
  history: { ops: OTOperation; userId: number }[];
  historyStart: number;
  clients: Map<WebSocket, ClientInfo>;
  flushTimer?: ReturnType<typeof setTimeout>;
  inactivityTimer?: ReturnType<typeof setTimeout>;
  dirty: boolean;
  lastFlushedContent: string;
  /** Failed flushes in a row, for the retry backoff. */
  failedFlushes: number;
  /** closeSession is running. */
  closing: boolean;
  /** Settles when the write in progress, if any, is done. Never rejects. */
  flushing?: Promise<void>;
  /** Writes started so far, to tell a disk read that raced one of them. */
  writes: number;
  /** The file vanished from disk; no flush until we know where it went. */
  flushesHeld?: boolean;
  /** When the oldest edit not yet written was made (ms), or since the last failed write. */
  dirtySince?: number;
}

/** A flush runs after this much typing inactivity... */
const FLUSH_DEBOUNCE_MS = 3_000;
/** ...or at the latest this long after the oldest edit not on disk. */
const FLUSH_MAX_WAIT_MS = 15_000;
/** First retry after a failed flush; doubles on each failure up to the cap. */
const FLUSH_RETRY_MS = 5_000;
const FLUSH_RETRY_MAX_MS = 60_000;

export class OTSessionManager {
  private readonly logger = new Logger('OTSessionManager');
  private sessions = new Map<string, DocumentSession>();
  private onFlush?: (docId: string, content: string) => Promise<void>;
  private onSessionClose?: (docId: string) => Promise<void>;
  private onDiffCapture?: (docId: string, oldContent: string, newContent: string, userId: number | null) => void;
  private onFlushResult?: (docId: string, success: boolean, error?: string) => void;
  private onConcurrentEdit?: () => void;

  setFlushHandler(handler: (docId: string, content: string) => Promise<void>) {
    this.onFlush = handler;
  }

  setSessionCloseHandler(handler: (docId: string) => Promise<void>) {
    this.onSessionClose = handler;
  }

  setDiffCaptureHandler(handler: (docId: string, oldContent: string, newContent: string, userId: number | null) => void) {
    this.onDiffCapture = handler;
  }

  setFlushResultHandler(handler: (docId: string, success: boolean, error?: string) => void) {
    this.onFlushResult = handler;
  }

  setConcurrentEditHandler(handler: () => void) {
    this.onConcurrentEdit = handler;
  }

  getOrCreateSession(docId: string, initialContent: string): DocumentSession {
    let session = this.sessions.get(docId);
    if (session) {
      this.logger.debug(`Reusing session for "${docId}", rev=${session.revision}, dirty=${session.dirty}, clients=${session.clients.size}`);
    } else {
      session = {
        docId,
        content: initialContent,
        revision: 0,
        history: [],
        historyStart: 0,
        clients: new Map(),
        dirty: false,
        lastFlushedContent: initialContent,
        failedFlushes: 0,
        closing: false,
        writes: 0,
      };
      this.sessions.set(docId, session);
      this.logger.debug(`New session for "${docId}", content length=${initialContent?.length}`);
    }
    return session;
  }

  getSession(docId: string): DocumentSession | undefined {
    return this.sessions.get(docId);
  }

  /** Ids of open sessions for `path` itself or anything under `path/` (folder moves). */
  sessionIdsAtOrUnder(path: string): string[] {
    const prefix = path + '/';
    return [...this.sessions.keys()].filter((id) => id === path || id.startsWith(prefix));
  }

  /**
   * Re-key a session after its file was renamed on disk, so later flushes
   * write to the new path. Timers capture the doc id in their closure, so they
   * are re-armed under `newId`. A session already at `newId` (opened on a path
   * that had no file yet) is discarded; its clients are returned so the caller
   * can tell them to reload. Returns null when there is no session at `oldId`.
   */
  renameSession(oldId: string, newId: string): { displaced: WebSocket[] } | null {
    const session = this.sessions.get(oldId);
    if (!session || oldId === newId) return null;

    let displaced: WebSocket[] = [];
    const existing = this.sessions.get(newId);
    if (existing) {
      this.logger.warn(`renameSession: discarding session already open at "${newId}"`);
      if (existing.flushTimer) clearTimeout(existing.flushTimer);
      if (existing.inactivityTimer) clearTimeout(existing.inactivityTimer);
      displaced = [...existing.clients.keys()];
    }

    this.sessions.delete(oldId);
    session.docId = newId;
    this.sessions.set(newId, session);

    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = undefined;
    // Flushes held because the old path vanished can go to the new one.
    session.flushesHeld = false;
    if (session.dirty) {
      this.scheduleDebouncedFlush(newId);
    } else {
      this.resetInactivityTimer(newId);
    }
    this.logger.debug(`Renamed session "${oldId}" -> "${newId}", dirty=${session.dirty}`);
    return { displaced };
  }

  /**
   * Stop writing the session to disk: its file vanished, and until we know
   * whether it was deleted, renamed or is being re-created, a flush would
   * re-create it. Edits keep landing in memory.
   */
  holdFlushes(docId: string): void {
    const session = this.sessions.get(docId);
    if (!session) return;
    session.flushesHeld = true;
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = undefined;
  }

  /** Undo holdFlushes: the file is back. */
  releaseFlushes(docId: string): void {
    const session = this.sessions.get(docId);
    if (!session?.flushesHeld) return;
    session.flushesHeld = false;
    if (session.dirty) this.scheduleDebouncedFlush(docId);
  }

  /**
   * Drop a session without the close-time flush or close handler: its file
   * has left the vault (moved to the trash), so flushing would re-create it at
   * `docId`. Returns the clients that were attached, plus the in-memory
   * content when it holds edits not yet on disk.
   */
  discardSession(docId: string): { clients: WebSocket[]; unflushed: string | null } | null {
    const session = this.sessions.get(docId);
    if (!session) return null;
    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);
    this.sessions.delete(docId);
    this.logger.debug(`Discarded session "${docId}", dirty=${session.dirty}`);
    return {
      clients: [...session.clients.keys()],
      unflushed: session.dirty ? session.content : null,
    };
  }

  resetContent(docId: string, newContent: string): void {
    const session = this.sessions.get(docId);
    if (!session) return;
    session.content = newContent;
    session.revision++;
    session.history = [];
    session.historyStart = session.revision;
    session.dirty = false;
    session.dirtySince = undefined;
    session.lastFlushedContent = newContent;
    this.logger.debug(`Reset session "${docId}", rev=${session.revision}, content length=${newContent.length}`);
  }

  /**
   * Bring a change made to the note's file without going through the session
   * (another program, a write that raced the session's start) into the live
   * content. `read` returns the file's content. Waits for a write of ours in
   * progress, and reads again when one landed during the read, so the
   * session's own writes are never taken for outside changes. Resolves to
   * the op applied to the session, or null when the file holds nothing new.
   */
  async mergeFromDisk(
    docId: string,
    read: () => Promise<string>,
  ): Promise<{ ops: OTOperation; revision: number } | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let session = this.sessions.get(docId);
      while (session?.flushing) {
        await session.flushing;
        session = this.sessions.get(docId);
      }
      if (!session) return null;
      const writes = session.writes;
      let disk: string;
      try {
        disk = await read();
      } catch {
        return null; // Gone or unreadable: the unlink handling decides
      }
      if (this.sessions.get(docId) !== session) return null;
      if (session.flushing || session.writes !== writes) continue;
      return this.mergeDiskContent(session, disk);
    }
    this.logger.warn(`Could not read "${docId}" between writes, external change not merged`);
    return null;
  }

  /**
   * Both the disk change and the session's unsaved edits are diffs of the
   * content last saved: transform the disk change past the unsaved edits and
   * apply it as a server op, so neither side is lost.
   */
  private mergeDiskContent(
    session: DocumentSession,
    disk: string,
  ): { ops: OTOperation; revision: number } | null {
    const base = session.lastFlushedContent;
    if (disk === base) return null;
    let ops = diffToOps(base, disk)!;
    const local = diffToOps(base, session.content);
    if (local) [ops] = transform(ops, local);
    session.lastFlushedContent = disk;

    let result: { ops: OTOperation; revision: number } | null = null;
    if (ops.some((c) => c.type !== 'retain')) {
      result = this.applyOperation(session.docId, ops, session.revision, 0);
    }
    // Clean when the merged content is exactly what is on disk.
    session.dirty = session.content !== disk;
    if (!session.dirty) session.dirtySince = undefined;
    this.logger.debug(`Merged disk change into "${session.docId}", rev=${session.revision}, dirty=${session.dirty}`);
    return result;
  }

  addClient(docId: string, ws: WebSocket, userId: number, email: string): void {
    const session = this.sessions.get(docId);
    if (session) {
      session.clients.set(ws, { ws, userId, email });
      this.resetInactivityTimer(docId);
    }
  }

  removeClient(docId: string, ws: WebSocket): void {
    const session = this.sessions.get(docId);
    if (!session) {
      this.logger.debug(`removeClient: no session found for "${docId}"`);
      return;
    }

    session.clients.delete(ws);
    this.logger.debug(`Removed client from "${docId}", remaining=${session.clients.size}, dirty=${session.dirty}`);

    if (session.clients.size === 0) {
      this.logger.debug(`No clients left for "${docId}", closing session`);
      this.closeSessionInBackground(docId);
    }
  }

  applyOperation(
    docId: string,
    clientOps: OTOperation,
    clientRev: number,
    userId: number,
  ): { ops: OTOperation; revision: number } | null {
    const session = this.sessions.get(docId);
    if (!session) return null;
    // Older than the ops still kept (or not a revision of this session): there
    // is nothing to transform it against.
    if (!Number.isInteger(clientRev) || clientRev < session.historyStart || clientRev > session.revision) {
      this.logger.debug(`Rejected op "${docId}" at rev=${clientRev}, kept revisions ${session.historyStart}..${session.revision}`);
      return null;
    }

    // Transform against all operations since client's revision
    const needsTransform = clientRev < session.revision;
    let transformedOps = clientOps;
    for (let i = clientRev; i < session.revision; i++) {
      const serverOp = session.history[i - session.historyStart];
      const [clientPrime] = transform(transformedOps, serverOp.ops);
      transformedOps = clientPrime;
    }

    if (needsTransform && this.onConcurrentEdit) {
      this.onConcurrentEdit();
    }

    // Apply to server document
    const prevContent = session.content;
    session.content = apply(session.content, transformedOps);
    session.revision++;
    session.history.push({ ops: transformedOps, userId });
    session.dirty = true;
    this.logger.debug(`Applied op "${docId}", rev=${session.revision}, length: ${prevContent.length} -> ${session.content.length}`);


    // Debounced flush
    this.scheduleDebouncedFlush(docId);

    return { ops: transformedOps, revision: session.revision };
  }

  getClients(docId: string): Map<WebSocket, ClientInfo> | undefined {
    return this.sessions.get(docId)?.clients;
  }

  getContent(docId: string): string | undefined {
    return this.sessions.get(docId)?.content;
  }

  getRevision(docId: string): number {
    return this.sessions.get(docId)?.revision ?? 0;
  }

  getActiveSessions(): { docId: string; clientCount: number; revision: number }[] {
    const result: { docId: string; clientCount: number; revision: number }[] = [];
    for (const [docId, session] of this.sessions) {
      if (session.clients.size > 0) {
        result.push({ docId, clientCount: session.clients.size, revision: session.revision });
      }
    }
    return result;
  }

  private scheduleDebouncedFlush(docId: string): void {
    const session = this.sessions.get(docId);
    if (!session) return;

    // 3 seconds of inactivity, but no later than FLUSH_MAX_WAIT_MS after the
    // oldest unsaved edit: continuous typing must still reach the disk.
    const now = Date.now();
    session.dirtySince ??= now;
    const delay = Math.max(0, Math.min(FLUSH_DEBOUNCE_MS, session.dirtySince + FLUSH_MAX_WAIT_MS - now));
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = setTimeout(() => {
      this.flushToDisk(docId).catch(() => {
        // Error already logged in flushToDisk; dirty flag preserved for retry
      });
    }, delay);

    this.resetInactivityTimer(docId);
  }

  private resetInactivityTimer(docId: string): void {
    const session = this.sessions.get(docId);
    if (!session) return;

    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);
    session.inactivityTimer = setTimeout(() => {
      this.closeSessionInBackground(docId);
    }, 5 * 60 * 1000); // 5 minutes
  }

  /** Retry a failed flush later, backing off while it keeps failing. */
  private scheduleFlushRetry(docId: string): void {
    const session = this.sessions.get(docId);
    if (!session || !session.dirty) return;
    if (session.flushTimer) clearTimeout(session.flushTimer);
    const delay = Math.min(FLUSH_RETRY_MS * 2 ** (session.failedFlushes - 1), FLUSH_RETRY_MAX_MS);
    session.flushTimer = setTimeout(() => {
      this.flushToDisk(docId).catch(() => {
        // Logged in flushToDisk, which schedules the next retry
      });
    }, delay);
  }

  /** Timers and disconnects can't await a close; its failures must not escape. */
  private closeSessionInBackground(docId: string): void {
    this.closeSession(docId).catch((err) => {
      this.logger.error(`Closing session "${docId}" failed`, err);
    });
  }

  /**
   * Save every session's unsaved edits, e.g. before the process exits.
   * Stops waiting after `timeoutMs`; failures are logged.
   */
  async flushAll(timeoutMs: number): Promise<void> {
    const dirty = [...this.sessions.values()].filter((s) => s.dirty).map((s) => s.docId);
    if (dirty.length === 0) return;
    this.logger.log(`Saving ${dirty.length} open note(s)`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    });
    const saved = Promise.all(dirty.map((id) => this.flushNow(id).catch(() => undefined))).then(() => false);
    const late = await Promise.race([saved, timedOut]);
    clearTimeout(timer);
    if (late) this.logger.warn(`Gave up waiting for open notes to save after ${timeoutMs} ms`);
  }

  async flushNow(docId: string): Promise<void> {
    const session = this.sessions.get(docId);
    if (!session) return;
    // Cancel pending debounce and flush immediately
    if (session.flushTimer) clearTimeout(session.flushTimer);
    // Let errors propagate so callers (gateway) can send flush:error
    await this.flushToDisk(docId);
  }

  private async flushToDisk(docId: string): Promise<void> {
    let session = this.sessions.get(docId);
    // One write per session at a time, so an older content never lands last.
    while (session?.flushing) {
      await session.flushing;
      session = this.sessions.get(docId);
    }
    if (!session || !session.dirty || session.flushesHeld) {
      this.logger.debug(`Flush skip for "${docId}" — session=${!!session}, dirty=${session?.dirty}, held=${!!session?.flushesHeld}`);
      return;
    }

    this.logger.debug(`Flushing "${docId}" to disk, content length=${session.content.length}`);
    const oldContent = session.lastFlushedContent;
    const newContent = session.content;
    let flushDone!: () => void;
    session.flushing = new Promise<void>((resolve) => { flushDone = resolve; });
    session.writes++;
    try {
      if (this.onFlush) {
        await this.onFlush(docId, newContent);
      }
      // Edits made while the write was in flight are not on disk yet.
      session.dirty = session.content !== newContent;
      session.dirtySince = session.dirty ? Date.now() : undefined;
      session.lastFlushedContent = newContent;
      session.failedFlushes = 0;
      if (session.dirty && this.sessions.get(docId) === session) this.scheduleDebouncedFlush(docId);

      // Trim history to sliding window after successful flush
      const historyWindow = 1000;
      const trimmed = session.history.length - historyWindow;
      if (trimmed > 0) {
        session.history = session.history.slice(trimmed);
        session.historyStart += trimmed;
      }

      // Notify listeners of successful flush
      this.onFlushResult?.(docId, true);
    } catch (err) {
      // Flush failed — keep dirty and retry, even if nobody types again.
      // Typing restarts the max-wait so a failing disk isn't hit per keystroke.
      session.failedFlushes++;
      session.dirtySince = Date.now();
      this.logger.error(`Flush failed for "${docId}", keeping dirty`, err);
      this.onFlushResult?.(docId, false, String(err));
      if (this.sessions.get(docId) === session) this.scheduleFlushRetry(docId);
      throw err;
    } finally {
      session.flushing = undefined;
      flushDone();
    }
    // Capture diff asynchronously (fire-and-forget)
    if (this.onDiffCapture && oldContent !== newContent) {
      // Resolve last-active userId from the session's operation history
      const lastUserId = session.history.length > 0
        ? session.history[session.history.length - 1].userId
        : null;
      try {
        this.onDiffCapture(docId, oldContent, newContent, lastUserId);
      } catch (err) {
        this.logger.error(`Diff capture error for "${docId}"`, err);
      }
    }
  }

  private async closeSession(docId: string): Promise<void> {
    const session = this.sessions.get(docId);
    // A close already in progress re-checks clients and edits before it
    // deletes anything.
    if (!session || session.closing) return;
    session.closing = true;
    try {
      await this.closeSessionOnce(docId, session);
    } finally {
      session.closing = false;
    }
  }

  private async closeSessionOnce(docId: string, session: DocumentSession): Promise<void> {
    this.logger.debug(`Closing session "${docId}", dirty=${session.dirty}, rev=${session.revision}`);

    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

    // Final flush. If it fails, keep the session: its edits are not on disk
    // yet, so it stays in memory to retry, and a client that opens the note
    // again gets them back.
    try {
      await this.flushToDisk(docId);
    } catch {
      this.logger.warn(`Final flush failed for "${docId}", keeping the session to retry`);
      if (this.sessions.get(docId) === session) this.resetInactivityTimer(docId);
      return;
    }

    // Race guard: a new client may have joined during the async flush
    if (this.keepAliveAfterClose(docId, session)) return;

    if (this.onSessionClose) {
      try {
        await this.onSessionClose(docId);
      } catch (err) {
        this.logger.error(`Session-close handler failed for "${docId}"`, err);
      }
    }

    // And again: a client that re-joined while the close handler ran (git
    // commit, embedding drain) is attached to this session object, so
    // deleting it would leave that client editing an orphan.
    if (this.keepAliveAfterClose(docId, session)) return;

    this.sessions.delete(docId);
    this.logger.debug(`Session deleted for "${docId}"`);
  }

  /**
   * True when a closing session must stay: it was dropped or re-keyed in
   * the meantime (not ours to delete), or a client or an edit arrived.
   */
  private keepAliveAfterClose(docId: string, session: DocumentSession): boolean {
    if (this.sessions.get(docId) !== session) return true;
    if (session.clients.size === 0 && !session.dirty) return false;
    this.logger.debug(`"${docId}" got clients or edits while closing, keeping session alive`);
    if (session.dirty) {
      this.scheduleDebouncedFlush(docId);
    } else {
      this.resetInactivityTimer(docId);
    }
    return true;
  }
}
