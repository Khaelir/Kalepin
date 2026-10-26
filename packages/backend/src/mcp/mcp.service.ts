import { Injectable, Logger, Optional, OnModuleDestroy, OnModuleInit, Inject } from '@nestjs/common';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { OAuthEventBus, type AccessTokenRevocation, type ApiKeyRevocation } from '../auth/oauth/oauth.events';
import { FilesService } from '../files';
import { SearchService } from '../search/search.service';
import { CommentsService } from '../comments/comments.service';
import { ChangeTrackingService } from '../changes';
import { BackupService } from '../backup/backup.service';
import { StatsService } from '../stats/stats.service';
import { OTService } from '../ot/ot.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { FileEntry } from '@kalepin/shared';
import { parseDrawioXml } from './drawio-graph-parser';
import { extractHeadings } from './extract-headings';
import type { ApiKeyScope } from '../auth/permissions';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import { PinService } from '../pin';
import { DocHandlesService, type ResolveResult } from '../doc-handles';

/** Shared schema text for the `id` argument every note-targeting tool accepts. */
const NOTE_ID_DESCRIPTION =
  'Stable note id, as returned by search_notes, read_note, create_note or list_files. Unlike the path, it survives renames and moves. Pass either path or id; id wins if both are given.';

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  userId: number;
  userEmail: string;
  scope?: ApiKeyScope;
  lastActivity: number;
  // Identifies the credential that initialised the session so a revocation
  // event (OAuth grant, API key) can deterministically close matching sessions.
  originCredential?:
    | { type: 'apikey'; id: number }
    | { type: 'oauth'; grantId: number; accessTokenHash: string };
}

interface McpUser {
  sub: number;
  email: string;
  scope?: ApiKeyScope;
  apiKeyId?: number;
  grantId?: number;
  originCredential?:
    | { type: 'apikey'; id: number }
    | { type: 'oauth'; grantId: number; accessTokenHash: string };
  /**
   * Optional one-shot unlock token from the X-Kalepin-Unlock header. Bound to a
   * single (path, viewer) — the PinService validates against both before
   * granting access.
   */
  pinUnlockHeader?: string;
}

@Injectable()
export class McpService implements OnModuleDestroy, OnModuleInit {
  private sessions = new Map<string, McpSession>();
  private readonly appUrl: string;
  private readonly sweepInterval: ReturnType<typeof setInterval>;
  private revocationUnsubscribe?: () => void;
  private apiKeyUnsubscribe?: () => void;

  private static readonly SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
  private static readonly SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly searchService: SearchService,
    private readonly commentsService: CommentsService,
    private readonly changeTracking: ChangeTrackingService,
    private readonly statsService: StatsService,
    private readonly otService: OTService,
    private readonly attachmentsService: AttachmentsService,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly encryptionPredicates: EncryptionPredicates,
    private readonly pinService: PinService,
    private readonly visibility: GrantAwareVisibility,
    private readonly docHandles: DocHandlesService,
    @Optional() private readonly backupService?: BackupService,
    @Optional() private readonly oauthEvents?: OAuthEventBus,
  ) {
    this.appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

    this.sweepInterval = setInterval(() => this.sweepStaleSessions(), McpService.SWEEP_INTERVAL_MS);
  }

  onModuleInit(): void {
    if (!this.oauthEvents) return;
    // OAuth-side revocation triggers an immediate session sweep so an
    // attacker who already has a session cookie can't continue running tools
    // after a user revokes the grant. Decision 12 / task 7.6.
    this.revocationUnsubscribe = this.oauthEvents.onAccessTokensRevoked(
      (rev: AccessTokenRevocation) => this.closeSessionsForOAuthRevocation(rev),
    );
    this.apiKeyUnsubscribe = this.oauthEvents.onApiKeyRevoked(
      (rev: ApiKeyRevocation) => this.closeSessionsForApiKey(rev.apiKeyId),
    );
  }

  onModuleDestroy() {
    clearInterval(this.sweepInterval);
    this.revocationUnsubscribe?.();
    this.apiKeyUnsubscribe?.();
  }

  private closeSessionsForOAuthRevocation(rev: AccessTokenRevocation): void {
    const targetHashes = new Set(rev.tokenHashes);
    for (const [sid, session] of this.sessions) {
      const oc = session.originCredential;
      if (!oc || oc.type !== 'oauth') continue;
      const matches =
        oc.grantId === rev.grantId ||
        (targetHashes.size > 0 && targetHashes.has(oc.accessTokenHash));
      if (matches) {
        this.logger.log(`Closing MCP session ${sid} due to OAuth revocation (grant=${rev.grantId}, reason=${rev.reason})`);
        session.transport.close().catch(() => {});
        this.sessions.delete(sid);
      }
    }
  }

  private closeSessionsForApiKey(apiKeyId: number): void {
    for (const [sid, session] of this.sessions) {
      const oc = session.originCredential;
      if (!oc || oc.type !== 'apikey') continue;
      if (oc.id === apiKeyId) {
        this.logger.log(`Closing MCP session ${sid} due to API key revocation (key=${apiKeyId})`);
        session.transport.close().catch(() => {});
        this.sessions.delete(sid);
      }
    }
  }

  private sweepStaleSessions() {
    const now = Date.now();
    for (const [sid, session] of this.sessions) {
      if (now - session.lastActivity > McpService.SESSION_TTL_MS) {
        this.logger.log(`Sweeping stale MCP session ${sid} (idle ${Math.round((now - session.lastActivity) / 1000)}s)`);
        session.transport.close().catch(() => {});
        this.sessions.delete(sid);
      }
    }
  }

  /**
   * Return a sentinel for read tools when the path is PIN-locked AND the
   * caller has not supplied a valid unlock header. Returns null if the call
   * may proceed.
   */
  private async pinReadSentinel(
    path: string,
    user: McpUser,
  ): Promise<{ content: { type: 'text'; text: string }[] } | null> {
    if (!(await this.pinService.hasPin(path))) return null;
    const headerToken = user.pinUnlockHeader ?? null;
    if (
      headerToken &&
      this.pinService.validateUnlockToken(headerToken, path, user.email.toLowerCase())
    ) {
      return null;
    }
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ kind: 'pin-protected', path }),
      }],
    };
  }

  /**
   * Throw a PIN-locked sentinel error string for write tools. We surface it as
   * a thrown Error so wrapTool's catch path logs the failure.
   */
  private async assertPinUnlockedForWrite(path: string, user: McpUser): Promise<void> {
    if (!(await this.pinService.hasPin(path))) return;
    const headerToken = user.pinUnlockHeader ?? null;
    if (
      headerToken &&
      this.pinService.validateUnlockToken(headerToken, path, user.email.toLowerCase())
    ) {
      return;
    }
    throw new Error(`pin-protected: ${path}`);
  }

  /**
   * Detect draw.io SVG attachments referenced in markdown.
   * Returns metadata about each diagram and the content with SVG references
   * replaced by inline placeholders.
   */
  private async detectDrawioDiagrams(markdownContent: string): Promise<{
    attachments: { id: string; type: string; label: string }[];
    content: string;
  }> {
    const svgRefs = [...markdownContent.matchAll(/!\[[^\]]*\]\(\/?_attachments\/([^\s)]+\.svg)\)/g)];
    if (svgRefs.length === 0) return { attachments: [], content: markdownContent };

    const attachments: { id: string; type: string; label: string }[] = [];
    let content = markdownContent;

    for (const match of svgRefs) {
      const name = match[1];
      const fullRef = match[0];
      try {
        const { buffer } = await this.attachmentsService.serve(name);
        const svgText = buffer.toString('utf-8');
        const contentMatch = svgText.match(/content="([^"]*)"/);
        if (contentMatch) {
          const decoded = contentMatch[1]
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
          if (decoded.includes('mxGraphModel') || decoded.includes('mxfile')) {
            attachments.push({ id: name, type: 'diagram/drawio', label: name });
            content = content.replace(fullRef, `[diagram: ${name} (draw.io)]`);
          }
        }
      } catch {
        // Attachment not found or not readable — skip
      }
    }

    return { attachments, content };
  }

  /** Build an app URL for a note, optionally targeting a specific comment thread. */
  private buildNoteUrl(noteId: string, threadId?: string): string {
    const query = threadId ? `?thread=${encodeURIComponent(threadId)}` : '';
    return `${this.appUrl}/doc/${noteId}${query}`;
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
    user: McpUser,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      if (session.userId !== user.sub) {
        this.rejectSessionMismatch(res, user.sub, session.userId);
        return;
      }
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }

    const isInitialize = Array.isArray(body)
      ? (body as any[]).some((m) => m.method === 'initialize')
      : (body as any)?.method === 'initialize';

    if (isInitialize) {
      // Create a new stateful session (fresh init or re-init with stale session ID)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });

      const server = this.createMcpServer(user);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);

      const sid = transport.sessionId!;
      this.sessions.set(sid, {
        transport,
        server,
        userId: user.sub,
        userEmail: user.email,
        scope: user.scope,
        lastActivity: Date.now(),
        originCredential: user.originCredential,
      });

      transport.onclose = () => {
        this.sessions.delete(sid);
      };
    } else {
      // Stale/expired session with a non-init message — handle statelessly.
      // Stateless transport skips session & init validation, so the request
      // is processed transparently without forcing the client to re-initialize.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      const server = this.createMcpServer(user);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);

      await server.close();
    }
  }

  async handleSseRequest(
    req: IncomingMessage,
    res: ServerResponse,
    user: McpUser,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId) {
      // 405 tells the MCP client that this server doesn't offer a standalone SSE stream
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed — use POST to initialize a session' }));
      return;
    }

    if (!this.sessions.has(sessionId)) {
      // 404 tells the client to drop the stale session and re-initialize via POST
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found — re-initialize via POST' }));
      return;
    }

    const session = this.sessions.get(sessionId)!;
    if (session.userId !== user.sub) {
      this.rejectSessionMismatch(res, user.sub, session.userId);
      return;
    }
    await session.transport.handleRequest(req, res);
  }

  async handleDeleteSession(
    req: IncomingMessage,
    res: ServerResponse,
    user: McpUser,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !this.sessions.has(sessionId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    const session = this.sessions.get(sessionId)!;
    if (session.userId !== user.sub) {
      this.rejectSessionMismatch(res, user.sub, session.userId);
      return;
    }
    await session.transport.close();
    this.sessions.delete(sessionId);
    res.writeHead(200);
    res.end();
  }

  private rejectSessionMismatch(res: ServerResponse, requestingUserId: number, sessionOwnerUserId: number): void {
    // Privilege-escalation guard: a request reusing an Mcp-Session-Id MUST come from
    // the user that created the session. Reject without invoking the session's transport,
    // so the closed-over McpServer (built at init with the original user's scope) is never run.
    this.statsService
      .logToolCall('mcp.session_mismatch', requestingUserId, null, 0, false, 'session_user_mismatch', {
        errorMessage: `Session owned by user ${sessionOwnerUserId}`,
      })
      .catch((err) => this.logger.warn(`Failed to log session mismatch: ${err.message}`));
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'session_user_mismatch' }));
  }

  /**
   * Static catalog of every tool name registered by `createMcpServer`.
   * Keep in sync with the `server.registerTool` calls below; the unit test
   * `mcp.tool-registration.test.ts` fails if a new wrapTool name isn't listed here.
   * Used by the Phase 4 leak-token e2e harness for route discovery.
   */
  static readonly REGISTERED_TOOLS = [
    // Read tools
    'search_notes',
    'read_note',
    'read_attachment',
    'list_files',
    'list_comments',
    // Write tools (canWriteNotes)
    'create_note',
    'patch_note',
    'append_to_note',
    'edit_note',
    'delete_note',
    // Comment-write tools (canWrite)
    'add_comment',
    'resolve_comment',
    // Misc
    'get_updates',
    // Admin tools
    'list_backups',
    'create_backup',
    'restore_backup',
    'mcp_stats',
  ] as const;

  /** Returns the full set of MCP tool names. Used by the leak-token e2e harness. */
  getRegisteredTools(): readonly string[] {
    return McpService.REGISTERED_TOOLS;
  }

  private wrapTool<TArgs>(
    name: string,
    user: McpUser,
    callback: (args: TArgs) => Promise<{ content: { type: 'text'; text: string }[]; _logOpts?: { resultCount?: number } }>,
  ): (args: TArgs) => Promise<{ content: { type: 'text'; text: string }[] }> {
    return async (args: TArgs) => {
      const start = Date.now();
      try {
        const result = await callback(args);
        const durationMs = Date.now() - start;
        const logOpts = result._logOpts;
        delete result._logOpts;
        this.statsService.logToolCall(name, user.sub, user.apiKeyId ?? null, durationMs, true, undefined, {
          resultCount: logOpts?.resultCount,
          grantId: user.grantId ?? null,
        }).catch((err) => {
          this.logger.warn(`Failed to log tool call for ${name}: ${err.message}`);
        });
        return result;
      } catch (err) {
        const durationMs = Date.now() - start;
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.statsService.logToolCall(name, user.sub, user.apiKeyId ?? null, durationMs, false, errorMsg, {
          errorMessage: errorMsg,
          grantId: user.grantId ?? null,
        }).catch((logErr) => {
          this.logger.warn(`Failed to log tool call for ${name}: ${logErr.message}`);
        });
        throw err;
      }
    };
  }

  private createMcpServer(user: McpUser): McpServer {
    const server = new McpServer({
      name: 'kalepin',
      version: '0.1.0',
    });

    const scope = user.scope;
    // Scope hierarchy: ro < rc < rw < admin
    // No scope (JWT user without API key) gets full write access but not admin
    const canWrite = !scope || scope === 'rc' || scope === 'rw' || scope === 'admin';
    const canWriteNotes = !scope || scope === 'rw' || scope === 'admin';
    const isAdmin = scope === 'admin';

    // --- Read Tools (always registered) ---

    server.registerTool(
      'search_notes',
      {
        description: 'Search across all notes and comments using full-text and semantic search. Results may include comments (type: "comment") with full thread text — comments often contain important context, decisions, or metadata not present in the note body. Each result carries the note\'s stable `id`, which other tools accept in place of `path`.',
        inputSchema: { query: z.string().describe('Search query') },
      },
      this.wrapTool('search_notes', user, async ({ query }) => {
        const results = await this.searchService.search(query, 'mcp', user.email.toLowerCase());
        const ids = await this.docHandles.findOrCreateForPaths(results.map((r) => r.path));
        // Replace any PIN-locked result with a sentinel so callers see the
        // path exists but cannot read its body.
        const filtered = await Promise.all(results.map(async (r) => {
          const id = ids.get(r.path)!;
          if (await this.pinReadSentinel(r.path, user)) {
            return { path: r.path, id, kind: 'pin-protected' as const };
          }
          return { ...r, id };
        }));
        return { content: [{ type: 'text' as const, text: JSON.stringify(filtered) }], _logOpts: { resultCount: filtered.length } };
      }),
    );

    server.registerTool(
      'read_note',
      {
        description: 'Read the markdown content of a note, including comment threads. Use maxLength to get an outline preview for long notes instead of full content.',
        inputSchema: {
          path: z.string().optional().describe('Path to the note (e.g. "projects/design.md")'),
          id: z.string().optional().describe(NOTE_ID_DESCRIPTION),
          maxLength: z.number().int().positive().optional().describe('Max content length in chars. If content exceeds this, returns heading outline + first paragraph instead of full content.'),
          include_resolved: z.boolean().optional().describe('Include resolved comment threads (default: false)'),
        },
      },
      this.wrapTool('read_note', user, async ({ path, id, maxLength, include_resolved }) => {
        const email = user.email.toLowerCase();
        const resolved = await this.resolveNoteRef({ path, id }, email);

        if (resolved.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${id ?? path}".` }] };
        }

        if (resolved.length > 1) {
          const listing = resolved.map((r) => `- ${r.path}: ${r.snippet}`).join('\n');
          return { content: [{ type: 'text' as const, text: `Multiple notes match "${path}":\n${listing}` }] };
        }

        const notePath = resolved[0].path;

        const pinSentinel = await this.pinReadSentinel(notePath, user);
        if (pinSentinel) return pinSentinel;

        // Stage-2 seam: when the note is end-to-end encrypted, the server
        // cannot return plaintext. Return a structured sentinel so callers
        // can recognize and surface the situation. Stage 1: never fires.
        if (this.encryptionPredicates.isE2EEncrypted(notePath)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `kind: e2e-encrypted\npath: ${notePath}\nThis note is end-to-end encrypted; only the user's device can decrypt it.`,
              },
            ],
          };
        }

        const rawContent = await this.filesService.readFile(notePath, email);
        const contentHash = this.filesService.computeContentHash(rawContent);
        const noteId = await this.docHandles.findOrCreateForPath(notePath);
        const noteUrl = this.buildNoteUrl(noteId);

        // Detect draw.io diagrams: replace SVG refs with placeholders, collect metadata
        const { attachments, content } = await this.detectDrawioDiagrams(rawContent);

        // Get comment threads, filter resolved by default
        const allThreads = await this.commentsService.getComments(notePath);
        const threads = include_resolved ? allThreads : allThreads.filter((t) => !t.resolved);
        const commentSummary = {
          total: allThreads.length,
          open: allThreads.filter((t) => !t.resolved).length,
          resolved: allThreads.filter((t) => t.resolved).length,
        };

        // Preview mode: return outline instead of full content
        if (maxLength && content.length > maxLength) {
          const headings = extractHeadings(content);
          const firstParagraph = content.split(/\n\n/)[0]?.slice(0, maxLength) || '';
          const outline = headings.length > 0 ? headings.join('\n') : content.slice(0, maxLength);

          const headerLines = [`path: ${notePath}`, `id: ${noteId}`, `contentHash: ${contentHash}`];
          if (attachments.length > 0) {
            headerLines.push(`attachments: ${JSON.stringify(attachments)}`);
          }
          headerLines.push(
            `fullLength: ${content.length}`,
            `[Open in Kalepin](${noteUrl})`,
            `comments: ${JSON.stringify(commentSummary)}`,
          );
          const header = headerLines.join('\n');

          const previewBody = headings.length > 0
            ? `## Outline\n\n${outline}\n\n## First Paragraph\n\n${firstParagraph}`
            : `## Preview\n\n${outline}`;

          return { content: [{ type: 'text' as const, text: `${header}\n\n${previewBody}` }] };
        }

        // Full mode
        const headerLines = [`path: ${notePath}`, `id: ${noteId}`, `contentHash: ${contentHash}`];
        if (attachments.length > 0) {
          headerLines.push(`attachments: ${JSON.stringify(attachments)}`);
        }
        headerLines.push(`[Open in Kalepin](${noteUrl})`);
        const header = headerLines.join('\n');

        if (threads.length > 0) {
          const commentSection = threads.map((t) => {
            const threadUrl = this.buildNoteUrl(noteId, t.id);
            const status = t.resolved ? ' (resolved)' : '';
            const quoted = t.quotedText ? `> ${t.quotedText}\n` : '';
            const msgs = t.comments.map((c) => `  - **${c.author}** (${c.createdAt}): ${c.text}`).join('\n');
            return `${quoted}[Thread${status}](${threadUrl}):\n${msgs}`;
          }).join('\n\n');
          return { content: [{ type: 'text' as const, text: `${header}\n\n${content}\n\n---\n## Comments\n\n${commentSection}` }] };
        }

        return { content: [{ type: 'text' as const, text: `${header}\n\n${content}` }] };
      }),
    );

    server.registerTool(
      'read_attachment',
      {
        description: 'Read a diagram attachment in a structured format. Returns a graph representation (nodes and edges) for draw.io diagrams. Use this after read_note reveals [diagram: X (draw.io)] placeholders to understand diagram topology.',
        inputSchema: {
          notePath: z.string().optional().describe('Path to the note that references the attachment'),
          noteId: z.string().optional().describe('Stable id of that note, usable in place of notePath; wins if both are given'),
          attachmentId: z.string().describe('Attachment filename (e.g. "flow.svg")'),
          format: z.enum(['structured', 'image']).optional().describe('Output format: "structured" (default) returns graph JSON, "image" is reserved for future use'),
        },
        annotations: { readOnlyHint: true },
      },
      this.wrapTool('read_attachment', user, async ({ notePath, noteId, attachmentId, format }) => {
        const email = user.email.toLowerCase();
        // Verify the note exists and references this attachment
        const resolved = await this.resolveNoteRef({ path: notePath, id: noteId }, email);
        if (resolved.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${noteId ?? notePath}".` }] };
        }
        const resolvedPath = resolved.length === 1 ? resolved[0].path : notePath!;
        if (this.encryptionPredicates.isE2EEncrypted(resolvedPath)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `kind: e2e-encrypted\npath: ${resolvedPath}\nattachmentId: ${attachmentId}\nThis note's attachments are end-to-end encrypted; only the user's device can decrypt them.`,
              },
            ],
          };
        }
        const noteContent = await this.filesService.readFile(resolvedPath, email);
        if (!noteContent.includes(attachmentId)) {
          return { content: [{ type: 'text' as const, text: `Attachment "${attachmentId}" not found in note "${resolvedPath}".` }] };
        }

        // Fetch the SVG — pass the resolved doc + requester so namespace is derived
        // from the doc context (personal-note attachments resolve from personal/_attachments/).
        let svgText: string;
        try {
          const { buffer } = await this.attachmentsService.serve(attachmentId, resolvedPath, email);
          svgText = buffer.toString('utf-8');
        } catch {
          return { content: [{ type: 'text' as const, text: `Attachment "${attachmentId}" not found.` }] };
        }

        // Extract draw.io XML
        const contentMatch = svgText.match(/content="([^"]*)"/);
        if (!contentMatch) {
          return { content: [{ type: 'text' as const, text: `Attachment "${attachmentId}" is not a draw.io diagram.` }] };
        }
        const decoded = contentMatch[1]
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        if (!decoded.includes('mxGraphModel') && !decoded.includes('mxfile')) {
          return { content: [{ type: 'text' as const, text: `Attachment "${attachmentId}" is not a draw.io diagram.` }] };
        }

        // Parse to structured graph
        const graph = parseDrawioXml(decoded);
        const result = {
          type: 'diagram/drawio',
          attachmentId,
          format: format || 'structured',
          graph,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }),
    );

    server.registerTool(
      'list_files',
      {
        description: 'List all note paths. Returns a flat newline-separated list of file paths.',
        inputSchema: {
          path: z.string().optional().describe('Optional subdirectory path to filter'),
          include_ids: z.boolean().optional().describe('Append each file\'s stable id, making each line "<path>\\t<id>" (default: false)'),
        },
      },
      this.wrapTool('list_files', user, async ({ path, include_ids }) => {
        // Agents often write folders as `Notes/` or `/Notes`; only the
        // slashes are forgiven, dot segments still fail the visibility check.
        const dir = (path || '').replace(/^\/+|\/+$/g, '');
        const tree = await this.filesService.listTree(dir, user.email.toLowerCase());
        const paths = this.flattenPaths(tree);
        if (!include_ids) {
          return { content: [{ type: 'text' as const, text: paths.join('\n') }] };
        }
        const ids = await this.docHandles.findOrCreateForPaths(paths);
        return { content: [{ type: 'text' as const, text: paths.map((p) => `${p}\t${ids.get(p)}`).join('\n') }] };
      }),
    );

    // --- Write Tools (note mutation — requires rw or admin scope) ---

    if (canWriteNotes) {
    server.registerTool(
      'create_note',
      {
        description: 'Create a new note',
        inputSchema: {
          path: z.string().describe('Path for the new note (e.g. "ideas/new-idea.md")'),
          content: z.string().describe('Markdown content for the note'),
        },
      },
      this.wrapTool('create_note', user, async ({ path, content }) => {
        // createFile appends `.md` when missing; check the PIN of, and mint the
        // id for, the path it actually writes.
        const writtenPath = path.endsWith('.md') ? path : `${path}.md`;
        await this.assertPinUnlockedForWrite(writtenPath, user);
        await this.filesService.createFile(writtenPath, content, user.sub, undefined, user.email.toLowerCase());
        const id = await this.docHandles.findOrCreateForPath(writtenPath);
        return { content: [{ type: 'text' as const, text: `Created note: ${writtenPath} (id: ${id})` }] };
      }),
    );

    server.registerTool(
      'patch_note',
      {
        description: 'Search-and-replace edit on a note. Finds exactly one occurrence of old_text and replaces it with new_text. Fails safely if not found or ambiguous. Use this for small/targeted edits instead of edit_note.',
        inputSchema: {
          path: z.string().optional().describe('Path to the note (e.g. "projects/design.md")'),
          id: z.string().optional().describe(NOTE_ID_DESCRIPTION),
          old_text: z.string().describe('Exact text to find (must match exactly once)'),
          new_text: z.string().describe('Replacement text (empty string to delete)'),
          base_hash: z.string().optional().describe('Content hash from read_note for conflict detection'),
        },
      },
      this.wrapTool('patch_note', user, async ({ path, id, old_text, new_text, base_hash }) => {
        const email = user.email.toLowerCase();
        const resolved = await this.resolveNoteRef({ path, id }, email);
        if (resolved.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${id ?? path}".` }] };
        }
        if (resolved.length > 1) {
          const listing = resolved.map((r) => `- ${r.path}`).join('\n');
          return { content: [{ type: 'text' as const, text: `Multiple notes match "${path}":\n${listing}\nPlease use the full path.` }] };
        }
        const resolvedPath = resolved[0].path;
        await this.assertPinUnlockedForWrite(resolvedPath, user);
        await this.filesService.patchFile(resolvedPath, old_text, new_text, base_hash, email);
        return { content: [{ type: 'text' as const, text: `Patched note: ${resolvedPath}` }] };
      }),
    );

    server.registerTool(
      'append_to_note',
      {
        description: 'Append content to the end of an existing note without reading or rewriting the full document. Ideal for adding new sections, list items, or log entries.',
        inputSchema: {
          path: z.string().optional().describe('Path to the note (e.g. "projects/design.md")'),
          id: z.string().optional().describe(NOTE_ID_DESCRIPTION),
          content: z.string().describe('Content to append'),
          separator: z.string().optional().describe('Separator between existing content and appended content (default: "\\n\\n")'),
          base_hash: z.string().optional().describe('Content hash from read_note for conflict detection'),
        },
      },
      this.wrapTool('append_to_note', user, async ({ path, id, content, separator, base_hash }) => {
        const email = user.email.toLowerCase();
        const resolved = await this.resolveNoteRef({ path, id }, email);
        if (resolved.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${id ?? path}". Use create_note to create a new one.` }] };
        }
        if (resolved.length > 1) {
          const listing = resolved.map((r) => `- ${r.path}`).join('\n');
          return { content: [{ type: 'text' as const, text: `Multiple notes match "${path}":\n${listing}\nPlease use the full path.` }] };
        }
        const resolvedPath = resolved[0].path;
        await this.assertPinUnlockedForWrite(resolvedPath, user);
        await this.filesService.appendToFile(resolvedPath, content, separator ?? '\n\n', base_hash, email);
        return { content: [{ type: 'text' as const, text: `Appended to note: ${resolvedPath}` }] };
      }),
    );

    server.registerTool(
      'edit_note',
      {
        description: 'Replace the full content of an existing note. For small or targeted edits, prefer patch_note (search-and-replace) which is faster and safer. Use edit_note only when you need to completely rewrite a note.',
        inputSchema: {
          path: z.string().optional().describe('Path to the note to edit'),
          id: z.string().optional().describe(NOTE_ID_DESCRIPTION),
          content: z.string().describe('New markdown content'),
          base_hash: z.string().optional().describe('Content hash from read_note for conflict detection'),
        },
      },
      this.wrapTool('edit_note', user, async ({ path, id, content, base_hash }) => {
        const email = user.email.toLowerCase();
        const resolved = await this.resolveNoteRef({ path, id }, email);
        if (resolved.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${id ?? path}". Use create_note to create a new one.` }] };
        }
        if (resolved.length > 1) {
          const listing = resolved.map((r) => `- ${r.path}`).join('\n');
          return { content: [{ type: 'text' as const, text: `Multiple notes match "${path}":\n${listing}\nPlease use the full path.` }] };
        }
        const resolvedPath = resolved[0].path;
        await this.assertPinUnlockedForWrite(resolvedPath, user);
        await this.filesService.createFile(resolvedPath, content, user.sub, base_hash, email);
        return { content: [{ type: 'text' as const, text: `Updated note: ${resolvedPath}` }] };
      }),
    );

    server.registerTool(
      'delete_note',
      {
        description: 'Delete a note',
        inputSchema: {
          path: z.string().optional().describe('Path to the note to delete'),
          id: z.string().optional().describe(NOTE_ID_DESCRIPTION),
        },
        annotations: { destructiveHint: true },
      },
      this.wrapTool('delete_note', user, async ({ path, id }) => {
        const email = user.email.toLowerCase();
        const resolved = await this.resolveNoteRef({ path, id }, email);
        if (resolved.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${id ?? path}".` }] };
        }
        if (resolved.length > 1) {
          const listing = resolved.map((r) => `- ${r.path}`).join('\n');
          return { content: [{ type: 'text' as const, text: `Multiple notes match "${path}":\n${listing}\nPlease use the full path.` }] };
        }
        const resolvedPath = resolved[0].path;
        await this.assertPinUnlockedForWrite(resolvedPath, user);
        await this.filesService.deleteFile(resolvedPath, user.sub, email);
        return { content: [{ type: 'text' as const, text: `Deleted note: ${resolvedPath}` }] };
      }),
    );
    } // end canWriteNotes

    server.registerTool(
      'list_comments',
      {
        description: 'List all comment threads on a note. Comments often contain important context, decisions, or metadata not in the note itself. Also returned by read_note, but use this tool when you need structured comment data.',
        inputSchema: {
          path: z.string().optional().describe('Path to the note'),
          id: z.string().optional().describe(NOTE_ID_DESCRIPTION),
        },
        annotations: { readOnlyHint: true },
      },
      this.wrapTool('list_comments', user, async ({ path, id }) => {
        const email = user.email.toLowerCase();
        const resolved = await this.resolveNoteRef({ path, id }, email);
        if (id && resolved.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${id}".` }] };
        }
        const resolvedPath = resolved.length === 1 ? resolved[0].path : path!;
        // Gate before fetching: existence is not observable for foreign personal paths.
        await this.visibility.assertReadableBy(resolvedPath, email);
        if (this.encryptionPredicates.isE2EEncrypted(resolvedPath)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `kind: e2e-encrypted\npath: ${resolvedPath}\nComments are disabled in end-to-end encrypted folders.`,
              },
            ],
          };
        }
        const comments = await this.commentsService.getComments(resolvedPath);
        // Only mint when there is a thread to link: an unmatched path falls
        // through to here and must not leave a handle behind.
        const noteId = comments.length > 0 ? await this.docHandles.findOrCreateForPath(resolvedPath) : '';
        const enriched = comments.map((t) => ({
          ...t,
          url: this.buildNoteUrl(noteId, t.id),
        }));
        return { content: [{ type: 'text' as const, text: JSON.stringify(enriched) }] };
      }),
    );

    // --- Comment Write Tools (requires rc, rw, or admin scope) ---

    if (canWrite) {
    server.registerTool(
      'add_comment',
      {
        description: 'Add a comment to a note. If threadId is provided, replies to an existing thread instead of creating a new one. Use quotedText to anchor the comment to specific text in the document.',
        inputSchema: {
          path: z.string().optional().describe('Path to the note'),
          id: z.string().optional().describe(NOTE_ID_DESCRIPTION),
          content: z.string().describe('Comment text'),
          blockId: z.string().optional().describe('Block ID to attach the comment to (defaults to a new UUID)'),
          threadId: z.string().optional().describe('Thread ID to reply to. If provided, adds a reply to the existing thread instead of creating a new one.'),
          quotedText: z.string().optional().describe('The exact text in the document this comment refers to. Used to anchor the comment to a specific passage.'),
          positionHint: z.object({
            from: z.number().describe('Start character offset in the document'),
            to: z.number().describe('End character offset in the document'),
          }).optional().describe('Character offset range (from/to) of the quoted text in the document. Optional but helps position the comment precisely.'),
        },
      },
      this.wrapTool('add_comment', user, async ({ path, id, content, blockId, threadId, quotedText, positionHint }) => {
        const email = user.email.toLowerCase();
        const resolved = await this.resolveNoteRef({ path, id }, email);
        if (id && resolved.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${id}".` }] };
        }
        const resolvedPath = resolved.length === 1 ? resolved[0].path : path!;
        await this.visibility.assertCommentableBy(resolvedPath, email);
        if (threadId) {
          await this.commentsService.replyToThread(resolvedPath, blockId || 'default', threadId, user.email, content);
          return { content: [{ type: 'text' as const, text: `Reply added to thread ${threadId} in ${resolvedPath}` }] };
        }
        const effectiveBlockId = blockId || randomUUID();
        const { thread } = await this.commentsService.addComment(resolvedPath, effectiveBlockId, user.email, content, quotedText, positionHint);
        return { content: [{ type: 'text' as const, text: `Comment added to ${resolvedPath} (threadId: ${thread.id}, blockId: ${effectiveBlockId})` }] };
      }),
    );

    server.registerTool(
      'resolve_comment',
      {
        description: 'Resolve or unresolve a comment thread on a note.',
        inputSchema: {
          path: z.string().optional().describe('Path to the note'),
          id: z.string().optional().describe(NOTE_ID_DESCRIPTION),
          threadId: z.string().describe('Thread ID to resolve or unresolve'),
          blockId: z.string().optional().describe('Block ID the thread belongs to (defaults to "default")'),
          resolved: z.boolean().optional().describe('Whether to resolve (true) or unresolve (false). Defaults to true.'),
        },
      },
      this.wrapTool('resolve_comment', user, async ({ path, id, threadId, blockId, resolved }) => {
        const email = user.email.toLowerCase();
        const matches = await this.resolveNoteRef({ path, id }, email);
        if (id && matches.length === 0) {
          return { content: [{ type: 'text' as const, text: `No notes found matching "${id}".` }] };
        }
        const resolvedPath = matches.length === 1 ? matches[0].path : path!;
        await this.visibility.assertCommentableBy(resolvedPath, email);
        await this.commentsService.resolveThread(resolvedPath, blockId || 'default', threadId, resolved ?? true);
        const action = (resolved ?? true) ? 'Resolved' : 'Unresolved';
        return { content: [{ type: 'text' as const, text: `${action} thread ${threadId} in ${resolvedPath}` }] };
      }),
    );
    } // end canWrite

    server.registerTool(
      'get_updates',
      {
        description: 'Get a summary of note changes since your last check. Returns stats and file list by default. Use include_diffs to get full unified diffs.',
        inputSchema: {
          since: z.string().optional().describe('Optional ISO 8601 datetime to get changes since (overrides last check time)'),
          include_diffs: z.boolean().optional().describe('Include unified diffs for each file change (default: false). Binary/diagram diffs are replaced with size placeholders.'),
        },
        annotations: { readOnlyHint: true },
      },
      this.wrapTool('get_updates', user, async ({ since, include_diffs }) => {
        const sinceDate = since ? new Date(since) : null;
        const response = await this.changeTracking.getChangesSince(sinceDate, user.sub, [], user.email.toLowerCase());

        // Shape MCP response: strip or filter diffs, and replace PIN-locked
        // entries with a sentinel so diffs do not leak content past the gate.
        const stripDiffs = async (folders: typeof response.starred) =>
          Promise.all(folders.map(async (g) => ({
            ...g,
            files: await Promise.all(g.files.map(async (f) => {
              if (await this.pinReadSentinel(f.path, user)) {
                return { path: f.path, kind: 'pin-protected' as const };
              }
              if (!include_diffs) {
                const { diffs, ...rest } = f;
                return rest;
              }
              // Filter binary/XML diffs
              return {
                ...f,
                diffs: f.diffs.map((d) => {
                  if (!d) return d;
                  if (/\.(svg|png|xml)$/i.test(f.path) || d.includes('mxGraphModel') || d.includes('mxfile')) {
                    return `[binary/diagram diff omitted — ${d.length} chars]`;
                  }
                  return d;
                }),
              };
            })),
          })));

        const mcpResponse = {
          period: response.period,
          stats: response.stats,
          starred: await stripDiffs(response.starred),
          other: await stripDiffs(response.other),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(mcpResponse) }] };
      }),
    );

    // --- Admin Tools (requires admin scope) ---

    const requireAdmin = (): { content: { type: 'text'; text: string }[] } | null => {
      if (user.scope !== 'admin') {
        return { content: [{ type: 'text' as const, text: 'Error: This tool requires an admin-scoped API key.' }] };
      }
      return null;
    };

    if (isAdmin && this.backupService) {
      const backupService = this.backupService;

      server.registerTool(
        'list_backups',
        {
          description: 'List available S3 backups with dates and sizes',
          inputSchema: {},
          annotations: { readOnlyHint: true },
        },
        this.wrapTool('list_backups', user, async () => {
          const denied = requireAdmin();
          if (denied) return denied;
          const backups = await backupService.listBackups();
          const formatted = backups.map((b) => ({
            key: b.key,
            size: `${(b.size / (1024 * 1024)).toFixed(2)} MB`,
            lastModified: b.lastModified.toISOString(),
            age: `${Math.round((Date.now() - b.lastModified.getTime()) / (1000 * 60 * 60 * 24))}d ago`,
          }));
          return { content: [{ type: 'text' as const, text: JSON.stringify(formatted) }] };
        }),
      );

      server.registerTool(
        'create_backup',
        {
          description: 'Trigger an on-demand backup to S3, returns key/size/duration',
          inputSchema: {},
        },
        this.wrapTool('create_backup', user, async () => {
          const denied = requireAdmin();
          if (denied) return denied;
          const result = await backupService.runBackup();
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }),
      );

      server.registerTool(
        'restore_backup',
        {
          description: 'Restore from a specific S3 backup. Creates a safety-net backup first. The app will restart after restore.',
          inputSchema: {
            key: z.string().optional().describe('Exact S3 key of the backup to restore'),
            nearTimestamp: z.string().optional().describe('ISO 8601 timestamp — restores the closest available backup'),
          },
          annotations: { destructiveHint: true },
        },
        this.wrapTool('restore_backup', user, async ({ key, nearTimestamp }) => {
          const denied = requireAdmin();
          if (denied) return denied;

          if (!key && !nearTimestamp) {
            return { content: [{ type: 'text' as const, text: 'Error: Provide either "key" or "nearTimestamp".' }] };
          }

          let targetKey = key;

          // Find closest backup by timestamp
          if (!targetKey && nearTimestamp) {
            const backups = await backupService.listBackups();
            if (backups.length === 0) {
              return { content: [{ type: 'text' as const, text: 'No backups available.' }] };
            }
            const target = new Date(nearTimestamp).getTime();
            backups.sort((a, b) =>
              Math.abs(a.lastModified.getTime() - target) - Math.abs(b.lastModified.getTime() - target),
            );
            targetKey = backups[0].key;
          }

          // 1. Safety-net backup
          this.logger.log(`Restore requested — creating safety-net backup first`);
          const safetyResult = await backupService.runBackup();

          // 2. Download and restore
          this.logger.log(`Restoring from ${targetKey}`);
          await backupService.restoreFromS3(targetKey!);

          const result = {
            restoredFrom: targetKey,
            safetyBackupKey: safetyResult.key,
            restoredAt: new Date().toISOString(),
            message: 'Restore complete. The app will restart in ~1 second to apply changes.',
          };

          // 3. Schedule process exit after MCP response flushes
          setTimeout(() => process.exit(0), 1000);

          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }),
      );
    }

    if (isAdmin) {
      server.registerTool(
        'mcp_stats',
        {
          description: 'View MCP usage analytics and system health. Returns stats for the last 14 days.',
          inputSchema: {
            view: z.enum(['overview', 'tools', 'users', 'system', 'app_stats']).describe('"overview" = daily aggregates, "tools" = per-tool stats with P50/P95, "users" = per-user stats, "system" = system health, "app_stats" = daily app-level stats + failed searches'),
          },
          annotations: { readOnlyHint: true },
        },
        this.wrapTool('mcp_stats', user, async ({ view }) => {
          const denied = requireAdmin();
          if (denied) return denied;
          let data: unknown;
          switch (view) {
            case 'overview': data = await this.statsService.getOverview(); break;
            case 'tools': data = await this.statsService.getMcpTools(); break;
            case 'users': data = await this.statsService.getUsers(); break;
            case 'system': data = await this.statsService.getSystemHealth({
              uptimeSeconds: Math.round(process.uptime()),
              embeddingModel: this.searchService.getEmbeddingModelStatus(),
              vectorCache: this.searchService.getVectorCacheStats(),
              otSessions: this.otService.sessionManager.getActiveSessions(),
            }); break;
            case 'app_stats': data = await this.statsService.getAppStats(); break;
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
        }),
      );
    }

    // --- Resources ---

    server.registerResource(
      'note',
      new ResourceTemplate('note://{path}', { list: undefined }),
      { description: 'A markdown note', mimeType: 'text/markdown' },
      async (uri, variables) => {
        const notePath = variables.path as string;
        const content = await this.filesService.readFile(notePath);
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/markdown',
            text: content,
          }],
        };
      },
    );

    server.registerResource(
      'tree',
      'tree://files',
      { description: 'The complete file tree of all notes' },
      async (uri) => {
        const tree = await this.filesService.listTree('', user.email.toLowerCase());
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(tree),
          }],
        };
      },
    );

    // --- Prompts ---

    server.registerPrompt(
      'summarize-notes',
      {
        description: 'Summarize all notes in a directory',
        argsSchema: { path: z.string().describe('Directory path to summarize (e.g. "projects/")') },
      },
      async ({ path }) => {
        const email = user.email.toLowerCase();
        const tree = await this.filesService.listTree('', email);
        const notePaths = this.collectMarkdownPaths(tree, path);

        const noteContents: string[] = [];
        for (const notePath of notePaths) {
          try {
            const content = await this.filesService.readFile(notePath, email);
            noteContents.push(`## ${notePath}\n\n${content}`);
          } catch {
            // Skip unreadable notes
          }
        }

        return {
          messages: [{
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Please summarize the following notes from "${path}":\n\n${noteContents.join('\n\n---\n\n')}`,
            },
          }],
        };
      },
    );

    server.registerPrompt(
      'review-doc',
      {
        description: 'Review a document and provide feedback',
        argsSchema: { path: z.string().describe('Path to the note to review') },
      },
      async ({ path }) => {
        const email = user.email.toLowerCase();
        const resolved = await this.resolveNotePath(path, email);

        if (resolved.length === 0) {
          return {
            messages: [{
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `No notes found matching "${path}". Please try a different path.`,
              },
            }],
          };
        }

        if (resolved.length > 1) {
          const listing = resolved.map((r) => `- **${r.path}**: ${r.snippet}`).join('\n');
          return {
            messages: [{
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `Multiple notes match "${path}". Which one would you like to review?\n\n${listing}`,
              },
            }],
          };
        }

        const match = resolved[0];
        const content = await this.filesService.readFile(match.path, email);
        return {
          messages: [{
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Please review the following document and provide detailed feedback on clarity, structure, completeness, and any improvements:\n\n# ${match.path}\n\n${content}`,
            },
          }],
        };
      },
    );

    return server;
  }

  /**
   * Resolve a tool's `{ path, id }` input to matching note(s). An id is exact:
   * it resolves to the note's current path or to nothing. A path goes through
   * the fuzzy matching of resolveNotePath.
   */
  private async resolveNoteRef(
    ref: { path?: string; id?: string },
    userEmail: string,
  ): Promise<{ path: string; snippet: string }[]> {
    if (ref.id) {
      const path = await this.pathForNoteId(ref.id, userEmail);
      return path ? [{ path, snippet: '' }] : [];
    }
    if (!ref.path) throw new Error('Provide either a note path or an id.');
    return this.resolveNotePath(ref.path, userEmail);
  }

  /**
   * Map a note id to its current path. Unknown ids and ids of notes the caller
   * cannot read both come back null, so an id never reveals that a foreign
   * note exists. Visibility is checked before the tombstone for the same reason.
   */
  private async pathForNoteId(id: string, userEmail: string): Promise<string | null> {
    let handle: ResolveResult;
    try {
      handle = await this.docHandles.resolve(id);
      await this.visibility.assertReadableBy(handle.path, userEmail);
    } catch {
      return null;
    }
    if (handle.tombstoned) throw new Error(`Note ${id} has been deleted.`);
    return handle.path;
  }

  /**
   * Resolve a fuzzy path input to matching note(s).
   * Tries exact match first, then case-insensitive filename match, then search.
   */
  private async resolveNotePath(input: string, userEmail?: string): Promise<{ path: string; snippet: string }[]> {
    // 1. Try exact match
    try {
      await this.filesService.readFile(input, userEmail);
      return [{ path: input, snippet: '' }];
    } catch { /* not found */ }

    // 2. Collect all markdown paths and try case-insensitive matching
    const tree = await this.filesService.listTree('', userEmail);
    const allPaths = this.collectMarkdownPaths(tree, '');
    const lower = input.toLowerCase().replace(/\.md$/, '');

    // Try progressively looser matching, stopping at the first tier that matches
    const tiers: ((p: string) => boolean)[] = [
      // Tier 1: exact path (case-insensitive)
      (p) => { const n = p.toLowerCase().replace(/\.md$/, ''); return n === lower || p.toLowerCase() === lower + '.md'; },
      // Tier 2: exact basename match
      (p) => { const baseName = p.toLowerCase().replace(/\.md$/, '').split('/').pop() || ''; return baseName === lower; },
      // Tier 3: path contains input (loose)
      (p) => p.toLowerCase().replace(/\.md$/, '').includes(lower),
    ];

    let matches: string[] = [];
    for (const tier of tiers) {
      matches = allPaths.filter(tier);
      if (matches.length > 0) break;
    }

    if (matches.length > 0) {
      return Promise.all(matches.map(async (p) => {
        try {
          const content = await this.filesService.readFile(p, userEmail);
          return { path: p, snippet: content.slice(0, 100).replace(/\n/g, ' ') + '...' };
        } catch {
          return { path: p, snippet: '' };
        }
      }));
    }

    // 3. Fall back to search
    const results = await this.searchService.search(input, 'mcp', userEmail);
    if (results.length > 0) {
      return results.slice(0, 5).map((r) => ({
        path: r.path,
        snippet: (r.snippet || '').replace(/<\/?mark>/g, '').slice(0, 100) + '...',
      }));
    }

    return [];
  }

  private flattenPaths(entries: FileEntry[]): string[] {
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.type === 'file' && !entry.path.includes('_attachments/')) {
        paths.push(entry.path);
      }
      if (entry.type === 'directory' && entry.children) {
        paths.push(...this.flattenPaths(entry.children));
      }
    }
    return paths;
  }

  private collectMarkdownPaths(entries: FileEntry[], prefix: string): string[] {
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.type === 'file' && entry.path.endsWith('.md') && entry.path.startsWith(prefix)) {
        paths.push(entry.path);
      }
      if (entry.type === 'directory' && entry.children) {
        paths.push(...this.collectMarkdownPaths(entry.children, prefix));
      }
    }
    return paths;
  }
}
