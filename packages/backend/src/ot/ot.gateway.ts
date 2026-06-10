import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { UseGuards, Inject, Logger, Optional, forwardRef } from '@nestjs/common';
import * as WebSocket from 'ws';
import { Server } from 'ws';
import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';
import { OTSessionManager } from './ot-session-manager';
import { OTService } from './ot.service';
import { AuthService, JwtPayload, GrantAwareVisibility } from '../auth';
import { isVisibleTo, isUnderPersonalRoot, PERSONAL_PREFIX } from '../auth/visibility';
// Import the concrete service files directly rather than the barrel
// (`'../files'`). The OT module sits on a circular module loop with
// FilesModule (FilesModule → ShareLinksModule → CommentsModule → SearchModule
// → OTModule → FilesModule). When that loop is being evaluated, the barrel's
// re-exports are still half-populated, so `import {…} from '../files'` here
// returns `undefined` for these classes — and TypeScript's emitted ctor
// metadata then captures `undefined` for the param type, breaking runtime DI.
// Direct file imports avoid the partial barrel.
import { FileWatcherService } from '../files/file-watcher.service';
import { FilesService } from '../files/files.service';
import { isAtomicWriteTmpPath } from '../storage';
import { LinkIndexService } from '../links/link-index.service';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import { AccessLogService } from '../access-log/access-log.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';

interface AuthenticatedWebSocket extends WebSocket {
  user?: JwtPayload;
  docId?: string;
}

@WebSocketGateway({ path: '/ws' })
export class OTGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OTGateway.name);

  @WebSocketServer()
  server!: Server;

  /**
   * Connected clients indexed by canonical email. Used to fan out personal-watcher
   * events only to that user's WS sessions, and as the basis for `broadcastToVisible`.
   */
  private clientsByEmail = new Map<string, Set<AuthenticatedWebSocket>>();

  constructor(
    private readonly otService: OTService,
    private readonly authService: AuthService,
    private readonly fileWatcher: FileWatcherService,
    private readonly filesService: FilesService,
    @Inject(ENCRYPTION_PREDICATES) private readonly predicates: EncryptionPredicates,
    private readonly visibility: GrantAwareVisibility,
    private readonly accessLog: AccessLogService,
    private readonly docHandles: DocHandlesService,
    @Optional() @Inject(forwardRef(() => LinkIndexService)) private readonly linkIndexService?: LinkIndexService,
  ) {
    // Wire OT broadcast so rename-rewriting can push ops to clients
    this.linkIndexService?.setOTBroadcast((docId, ops, rev) => {
      this.broadcastToDocClients(docId, {
        type: 'op',
        docId,
        ops,
        rev,
      });
    });
    // Watch for external file changes (shared vault)
    this.fileWatcher.onFileChange((event) => {
      // Skip atomic-write tmp files: writeBytesAtomic emits add/change events
      // for `<path>.tmp.<hex>` before renaming into place. Those are an
      // implementation detail and must never reach clients.
      if (isAtomicWriteTmpPath(event.path)) return;
      if (event.event === 'change' || (event.event === 'add' && event.path.endsWith('.md'))) {
        // Skip broadcast if an OT session owns this document — the change
        // was caused by the OT flush, not an external editor.
        if (this.otService.sessionManager.getSession(event.path)) {
          return;
        }
        this.broadcastToDocClients(event.path, {
          type: 'file:changed',
          path: event.path,
        });
      }
      // Broadcast file tree updates for add/delete events.
      // Shared-vault paths are visible to every authenticated user, so plain
      // broadcast is safe here (the personal subtree never produces shared events).
      if (['add', 'unlink', 'addDir', 'unlinkDir'].includes(event.event)) {
        this.broadcastToAll({
          type: 'file:tree-update',
          event: event.event,
          path: event.path,
        });
      }
    });

    // Watch for personal-root file changes — fan out only to the owning user's WS.
    this.fileWatcher.onPersonalChange((event) => {
      if (isAtomicWriteTmpPath(event.path)) return;
      const email = this.extractPersonalOwnerEmail(event.path);
      if (!email) return;
      if (event.event === 'change' || (event.event === 'add' && event.path.endsWith('.md'))) {
        if (this.otService.sessionManager.getSession(event.path)) return;
        this.fanoutToEmail(email, {
          type: 'file:changed',
          path: event.path,
        });
      }
      if (['add', 'unlink', 'addDir', 'unlinkDir'].includes(event.event)) {
        this.fanoutToEmail(email, {
          type: 'file:tree-update',
          event: event.event,
          path: event.path,
        });
      }
    });

    // Broadcast flushed / flush:error to document clients
    this.otService.sessionManager.setFlushResultHandler((docId, success, error) => {
      if (success) {
        this.broadcastToDocClients(docId, { type: 'flushed', docId });
      } else {
        this.broadcastToDocClients(docId, { type: 'flush:error', docId, error });
      }
    });

    // Subscribe to external file writes (e.g. MCP)
    this.filesService.on('file:written', async (payload: { path: string }) => {
      const clients = await this.otService.handleExternalWrite(payload.path);
      if (clients && clients.length > 0) {
        const data = JSON.stringify({ type: 'doc:reload', path: payload.path });
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        }
      }
    });
  }

  async handleConnection(client: AuthenticatedWebSocket, req: IncomingMessage) {
    // Authenticate
    let token: string | undefined;
    if (req.url) {
      const parsed = parseUrl(req.url, true);
      token = parsed.query.token as string;
    }
    if (!token) {
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      client.close(4001, 'Unauthorized');
      return;
    }

    try {
      client.user = this.authService.verifyToken(token);
    } catch {
      client.close(4001, 'Unauthorized');
      return;
    }

    if (client.user?.email) {
      const email = client.user.email.toLowerCase();
      let set = this.clientsByEmail.get(email);
      if (!set) {
        set = new Set();
        this.clientsByEmail.set(email, set);
      }
      set.add(client);
    }
  }

  handleDisconnect(client: AuthenticatedWebSocket) {
    this.logger.debug(`Disconnect docId="${client.docId}", user=${client.user?.email}`);
    if (client.docId) {
      this.otService.sessionManager.removeClient(client.docId, client);
      // Broadcast presence leave
      this.broadcastToDocClients(client.docId, {
        type: 'presence:leave',
        docId: client.docId,
        userId: String(client.user?.sub),
      });
    }
    if (client.user?.email) {
      const email = client.user.email.toLowerCase();
      const set = this.clientsByEmail.get(email);
      if (set) {
        set.delete(client);
        if (set.size === 0) this.clientsByEmail.delete(email);
      }
    }
  }

  @SubscribeMessage('doc:open')
  async handleDocOpen(
    @ConnectedSocket() client: AuthenticatedWebSocket,
    @MessageBody() data: { docId: string },
  ) {
    if (!client.user) return;

    // Visibility gate — foreign personal docIds are non-observable.
    // Reject without opening, send a not_found error frame; do not close the
    // connection (other docIds on the same socket may still be openable).
    const viewerEmail = client.user.email.toLowerCase();
    const v = await this.visibility.visibilityFor(data.docId, viewerEmail);
    if (v.kind === 'denied' || v.kind === 'public_share') {
      // public_share isn't expected on this auth path (we never resolve a ?code= here).
      client.send(JSON.stringify({ type: 'error', code: 'not_found', docId: data.docId }));
      return;
    }
    if (v.kind === 'grant' && v.permission === 'read') {
      // Read-only grants do NOT permit live OT (which is bidirectional).
      // Surface as 'forbidden' so clients can fall back to a static viewer.
      client.send(JSON.stringify({ type: 'error', code: 'forbidden', docId: data.docId }));
      return;
    }
    // Comment grantees can open and observe ops but cannot send them — see handleOp.
    // The 'read' branch returned above, so v.permission is narrowed to 'comment' | 'write'.
    const permission: 'owner' | 'write' | 'comment' =
      v.kind === 'owner' ? 'owner' : (v.permission === 'comment' ? 'comment' : 'write');

    // Stage-2 seam: paths whose plaintext is not authoritative on the server
    // cannot run through the OT gateway. In stage 1 `canCollab` returns true
    // everywhere so this is dead code; the contract test stubs the predicate
    // to verify the rejection path.
    if (!this.predicates.canCollab(data.docId)) {
      client.send(JSON.stringify({ type: 'error', code: 'e2e-no-collab', docId: data.docId }));
      return;
    }

    const previousDocId = client.docId;
    this.logger.debug(`doc:open "${data.docId}", prev="${previousDocId}", user=${client.user.email}`);

    // Remove client from previous document session
    if (previousDocId && previousDocId !== data.docId) {
      this.logger.debug(`Removing client from previous session "${previousDocId}"`);
      this.otService.sessionManager.removeClient(previousDocId, client);
    }

    const { content, revision } = await this.otService.openDocument(
      data.docId,
      client,
      client.user.sub,
      client.user.email,
    );

    client.docId = data.docId;

    // Lazy-mint a doc handle so the frontend can normalize the URL bar to
    // /doc/<id> on receipt of doc:opened. Best-effort — a mint failure must
    // not block the OT session.
    let handleId: string | null = null;
    try {
      handleId = await this.docHandles.findOrCreateForPath(data.docId);
    } catch (err) {
      this.logger.warn(`failed to mint doc handle for "${data.docId}": ${(err as Error).message}`);
    }

    this.logger.debug(`Sending doc:opened for "${data.docId}", rev=${revision}, length=${content?.length}`);
    client.send(JSON.stringify({
      type: 'doc:opened',
      docId: data.docId,
      content,
      revision,
      permission,
      handle: handleId ? { id: handleId, path: data.docId } : null,
    }));

    // Broadcast presence join
    this.broadcastToDocClients(data.docId, {
      type: 'presence:join',
      docId: data.docId,
      userId: String(client.user.sub),
      email: client.user.email,
    }, client);
  }

  @SubscribeMessage('op')
  async handleOp(
    @ConnectedSocket() client: AuthenticatedWebSocket,
    @MessageBody() data: { docId: string; ops: unknown; rev: number },
  ) {
    if (!client.user) return;
    this.logger.debug(`op "${data.docId}", rev=${data.rev}, user=${client.user.email}`);

    // Comment-only grantees can observe ops but must not produce them. The
    // doc:open gate accepts comment grantees so they can view & comment, so
    // we re-check write permission on every op (server is authoritative).
    const v = await this.visibility.visibilityFor(data.docId, client.user.email.toLowerCase());
    const writable = v.kind === 'owner' || (v.kind === 'grant' && v.permission === 'write');
    if (!writable) {
      client.send(JSON.stringify({
        type: 'error',
        code: 'forbidden',
        docId: data.docId,
        message: 'Write permission required',
      }));
      return;
    }

    const result = await this.otService.applyOperation(
      data.docId,
      data.ops as any,
      data.rev,
      client.user.sub,
    );

    if (!result) {
      client.send(JSON.stringify({ type: 'error', message: 'Operation rejected' }));
      return;
    }

    // Edit access log: dedup window collapses rapid keystrokes to a single row.
    // No IP is available on the WebSocket frame path; that's expected.
    void this.accessLog.record(data.docId, client.user.email, 'edit', null);

    // Ack to sender
    client.send(JSON.stringify({
      type: 'ack',
      docId: data.docId,
      rev: result.revision,
    }));

    // Broadcast to other clients
    this.broadcastToDocClients(data.docId, {
      type: 'op',
      docId: data.docId,
      ops: result.ops,
      rev: result.revision,
    }, client);
  }

  @SubscribeMessage('doc:flush')
  async handleDocFlush(
    @ConnectedSocket() client: AuthenticatedWebSocket,
    @MessageBody() data: { docId: string },
  ) {
    if (!client.user) return;
    try {
      await this.otService.sessionManager.flushNow(data.docId);
      // The flushResultHandler already broadcasts to all clients;
      // send an explicit response to the requesting client as well
      client.send(JSON.stringify({ type: 'flushed', docId: data.docId }));
    } catch (err) {
      client.send(JSON.stringify({ type: 'flush:error', docId: data.docId, error: String(err) }));
    }
  }

  @SubscribeMessage('presence')
  handlePresence(
    @ConnectedSocket() client: AuthenticatedWebSocket,
    @MessageBody() data: { docId: string; cursor: number | null; selection: unknown },
  ) {
    if (!client.user) return;

    this.broadcastToDocClients(data.docId, {
      type: 'presence',
      docId: data.docId,
      userId: String(client.user.sub),
      email: client.user.email,
      cursor: data.cursor,
      selection: data.selection,
    }, client);
  }

  private broadcastToDocClients(docId: string, message: unknown, exclude?: WebSocket): void {
    const clients = this.otService.sessionManager.getClients(docId);
    if (!clients) return;
    const data = JSON.stringify(message);
    for (const [ws] of clients) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private broadcastToAll(message: unknown): void {
    const data = JSON.stringify(message);
    this.server?.clients?.forEach((client) => {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      } catch {
        // Ignore errors on individual clients
      }
    });
  }

  /**
   * Send a payload only to WebSocket clients authenticated as the given email.
   * Used to fan out personal-watcher events to the owning user without leaking
   * the event's path to anyone else.
   */
  private fanoutToEmail(email: string, message: unknown): void {
    const set = this.clientsByEmail.get(email.toLowerCase());
    if (!set) return;
    const data = JSON.stringify(message);
    for (const ws of set) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      } catch {
        // ignore
      }
    }
  }

  /** Extract `{email}` from a virtual `_users/{email}/...` path. Returns null if not personal. */
  private extractPersonalOwnerEmail(virtualPath: string): string | null {
    if (!isUnderPersonalRoot(virtualPath)) return null;
    const tail = virtualPath.slice(PERSONAL_PREFIX.length);
    const slash = tail.indexOf('/');
    return slash === -1 ? tail : tail.slice(0, slash);
  }
}
