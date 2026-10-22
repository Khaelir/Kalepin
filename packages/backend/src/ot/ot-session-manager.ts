import { Logger } from '@nestjs/common';
import { OTOperation } from '@kalepin/shared';
import { apply, transform } from './ot-engine';
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
  history: { ops: OTOperation; userId: number }[];
  clients: Map<WebSocket, ClientInfo>;
  flushTimer?: ReturnType<typeof setTimeout>;
  inactivityTimer?: ReturnType<typeof setTimeout>;
  dirty: boolean;
  lastFlushedContent: string;
}

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
        clients: new Map(),
        dirty: false,
        lastFlushedContent: initialContent,
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
    if (session.dirty) {
      this.scheduleDebouncedFlush(newId);
    } else {
      this.resetInactivityTimer(newId);
    }
    this.logger.debug(`Renamed session "${oldId}" -> "${newId}", dirty=${session.dirty}`);
    return { displaced };
  }

  resetContent(docId: string, newContent: string): void {
    const session = this.sessions.get(docId);
    if (!session) return;
    session.content = newContent;
    session.revision++;
    session.history = [];
    session.dirty = false;
    session.lastFlushedContent = newContent;
    this.logger.debug(`Reset session "${docId}", rev=${session.revision}, content length=${newContent.length}`);
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
      this.closeSession(docId);
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

    // Transform against all operations since client's revision
    const needsTransform = clientRev < session.revision;
    let transformedOps = clientOps;
    for (let i = clientRev; i < session.revision; i++) {
      const serverOp = session.history[i];
      if (!serverOp) return null; // revision too old
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

    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = setTimeout(() => {
      this.flushToDisk(docId).catch(() => {
        // Error already logged in flushToDisk; dirty flag preserved for retry
      });
    }, 3000); // 3 seconds of inactivity

    this.resetInactivityTimer(docId);
  }

  private resetInactivityTimer(docId: string): void {
    const session = this.sessions.get(docId);
    if (!session) return;

    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);
    session.inactivityTimer = setTimeout(() => {
      this.closeSession(docId);
    }, 5 * 60 * 1000); // 5 minutes
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
    const session = this.sessions.get(docId);
    if (!session || !session.dirty) {
      this.logger.debug(`Flush skip for "${docId}" — session=${!!session}, dirty=${session?.dirty}`);
      return;
    }

    this.logger.debug(`Flushing "${docId}" to disk, content length=${session.content.length}`);
    const oldContent = session.lastFlushedContent;
    const newContent = session.content;
    try {
      if (this.onFlush) {
        await this.onFlush(docId, newContent);
      }
      session.dirty = false;
      session.lastFlushedContent = newContent;

      // Trim history to sliding window after successful flush
      const historyWindow = 1000;
      if (session.history.length > historyWindow) {
        session.history = session.history.slice(session.history.length - historyWindow);
      }

      // Notify listeners of successful flush
      this.onFlushResult?.(docId, true);
    } catch (err) {
      // Flush failed — keep dirty so next debounce retries
      this.logger.error(`Flush failed for "${docId}", keeping dirty`, err);
      this.onFlushResult?.(docId, false, String(err));
      throw err;
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
    if (!session) return;

    this.logger.debug(`Closing session "${docId}", dirty=${session.dirty}, rev=${session.revision}`);

    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

    // Final flush
    await this.flushToDisk(docId);

    // Race guard: a new client may have joined during the async flush
    if (session.clients.size > 0) {
      this.logger.debug(`New clients joined "${docId}" during close flush, keeping session alive`);
      this.resetInactivityTimer(docId);
      return;
    }

    if (this.onSessionClose) {
      await this.onSessionClose(docId);
    }

    this.sessions.delete(docId);
    this.logger.debug(`Session deleted for "${docId}"`);
  }
}
