import { Controller, Get, Post, Delete, Body, Query, Req, Res, UseGuards, BadRequestException, UnprocessableEntityException, NotFoundException, GoneException, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Response } from 'express';
import { createHash } from 'crypto';
import * as archiver from 'archiver';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { VersionHistoryService } from '../changes';
import { OTService } from '../ot/ot.service';
import type { OTOperation } from '@kalepin/shared';
import { FilesService } from './files.service';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { personalRootFor } from '../auth/visibility';
import { appendVirtualTreeToArchive, type ManifestEntry } from './download-zip';
import { PinService } from '../pin';
import { GrantsService } from '../grants/grants.service';
import { canonicalizeEmail } from '../auth/email';
import type { Request } from 'express';
import { AccessLogService } from '../access-log/access-log.service';
import { ENCRYPTION_PREDICATES, EncryptionPredicates } from '../crypto/encryption-predicates';
import { extractClientIp } from '../access-log/extract-ip';
import { DocHandlesService } from '../doc-handles/doc-handles.service';

@Controller('api/files')
@UseGuards(CombinedAuthGuard)
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly versionHistory: VersionHistoryService,
    private readonly moduleRef: ModuleRef,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly pinService: PinService,
    private readonly grants: GrantsService,
    private readonly accessLog: AccessLogService,
    @Inject(ENCRYPTION_PREDICATES) private readonly predicates: EncryptionPredicates,
    private readonly docHandles: DocHandlesService,
  ) {}

  private getOTService(): OTService {
    return this.moduleRef.get(OTService, { strict: false });
  }

  @Get('tree')
  @RequiredScope('notes:read')
  async getTree(@Req() req: { user: JwtPayload }) {
    return this.filesService.listTree('', req.user.email);
  }

  @Get('shared-with-me')
  @RequiredScope('notes:read')
  async sharedWithMe(@Req() req: { user: JwtPayload }) {
    const email = canonicalizeEmail(req.user.email);
    // Same dangling-row safety net as `_shared_with_me/` in the file tree.
    const grants = await this.filesService.listLiveGrantsForGrantee(email);
    // Group by grantor for the sidebar's "from <grantor>" sections.
    const byGrantor = new Map<string, typeof grants>();
    for (const g of grants) {
      const list = byGrantor.get(g.grantorEmail) ?? [];
      list.push(g);
      byGrantor.set(g.grantorEmail, list);
    }
    return {
      groups: [...byGrantor.entries()].map(([grantor, items]) => ({
        grantor_email: grantor,
        items: items.map((g) => ({
          id: g.id,
          path: g.path,
          permission: g.permission,
          expires_at: g.expiresAt,
          created_at: g.createdAt,
        })),
      })),
    };
  }

  @Get('read')
  @RequiredScope('notes:read')
  async readFile(
    @Query('path') filePathQuery: string | undefined,
    @Query('handle') handleId: string | undefined,
    @Req() req: Request & { user: JwtPayload },
    @Res() res: Response,
  ) {
    let filePath: string;
    let handleIdResolved: string;

    // Error responses (410 tombstone, 404, 423 PIN) must never be cached: a
    // 410 is heuristically cacheable, and a trashed note can be restored, so a
    // cached 410 would keep showing "no longer exists" for a live /doc/<id>.
    // The success path below replaces this with its revalidating policy.
    res.setHeader('Cache-Control', 'no-store');

    if (handleId) {
      // Resolve handle → path. Tombstoned handles surface a typed 410 so the
      // frontend can render the "this note no longer exists" card.
      let resolved;
      try {
        resolved = await this.docHandles.resolve(handleId);
      } catch {
        throw new NotFoundException('Handle not found');
      }
      if (resolved.tombstoned) {
        throw new GoneException({ tombstoned: true, message: 'This note no longer exists' });
      }
      filePath = resolved.path;
      handleIdResolved = handleId;
    } else if (filePathQuery) {
      filePath = filePathQuery;
      handleIdResolved = await this.docHandles.findOrCreateForPath(filePath);
    } else {
      throw new BadRequestException('path or handle query parameter is required');
    }

    await this.pinService.assertUnlockedForRequest(req, filePath, req.user.email);
    const content = await this.filesService.readFile(filePath, req.user.email);
    const action = this.predicates.isE2EEncrypted(filePath) ? 'fetched' : 'view';
    void this.accessLog.record(filePath, req.user.email, action, extractClientIp(req));

    // Weak ETag over (path, content). Repeat opens of an unchanged file
    // collapse to a 304 so the browser replays its cached body — saving the
    // transfer and the JSON parse + setState on the client. Cache-Control
    // is `private` (per-user PIN/visibility) and `must-revalidate, max-age=0`
    // so the browser always asks but skips the body on a hit.
    const etag = `W/"${createHash('sha1').update(filePath).update('\0').update(content).digest('base64url')}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, must-revalidate, max-age=0');

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.status(200).json({
      path: filePath,
      content,
      handle: { id: handleIdResolved, path: filePath },
    });
  }

  @Post('create')
  @RequiredScope('notes:create')
  async createFile(
    @Body() body: { path: string; content?: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (typeof body?.path !== 'string') throw new BadRequestException('path is required');
    // Match server-side `.md` enforcement up front, so the PIN gate, the access
    // log and the handle all see the path FilesService.createFile writes.
    // Checking the raw path would let `x` overwrite a PIN-locked `x.md`.
    const writtenPath = body.path.endsWith('.md') ? body.path : `${body.path}.md`;
    await this.pinService.assertUnlockedForRequest(req, writtenPath, req.user.email);
    await this.filesService.createFile(writtenPath, body.content || '', req.user.sub, undefined, req.user.email);
    void this.accessLog.record(writtenPath, req.user.email, 'edit', extractClientIp(req));
    const handleId = await this.docHandles.findOrCreateForPath(writtenPath);
    return { path: writtenPath, handle: { id: handleId, path: writtenPath } };
  }

  @Delete('delete')
  @RequiredScope('notes:delete')
  async deleteFile(
    @Query('path') filePath: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    await this.pinService.assertUnlockedForRequest(req, filePath, req.user.email);
    const { trashItemId } = await this.filesService.deleteFile(filePath, req.user.sub, req.user.email);
    // trashItemId is null for permanent deletes (`_secure/` paths).
    return { deleted: filePath, trashItemId };
  }

  @Post('directory')
  @RequiredScope('notes:create')
  async createDirectory(@Body() body: { path: string }, @Req() req: { user: JwtPayload }) {
    await this.filesService.createDirectory(body.path, req.user.email);
    return { path: body.path };
  }

  @Delete('directory')
  @RequiredScope('notes:delete')
  async deleteDirectory(@Query('path') dirPath: string, @Req() req: { user: JwtPayload }) {
    const { trashItemId } = await this.filesService.deleteDirectory(dirPath, req.user.email, req.user.sub);
    return { deleted: dirPath, trashItemId };
  }

  @Post('move')
  @RequiredScope('notes:edit')
  async move(@Body() body: { src: string; dest: string }, @Req() req: Request & { user: JwtPayload }) {
    // PIN is bound to the source path's identity. The destination inherits no
    // PIN until the owner sets one.
    await this.pinService.assertUnlockedForRequest(req, body.src, req.user.email);
    await this.filesService.move(body.src, body.dest, req.user.email);
    return { src: body.src, dest: body.dest };
  }

  @Get('download-zip')
  @RequiredScope('notes:read')
  async downloadZip(@Res() res: Response, @Req() req: { user: JwtPayload }) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `Kalepin_vault_${stamp}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    // Every entry is read through the StorageAdapter. For at-rest paths the
    // adapter transparently decrypts; for E2E `_secure/` paths it returns the
    // raw envelope (the server never has the master-KEK). The manifest tells
    // the recipient which entries are which so they know what to decrypt
    // locally.
    const manifest: ManifestEntry[] = [];
    await appendVirtualTreeToArchive(archive, this.storage, '', { skipPersonalAtRoot: true, manifest });
    const ownPersonal = personalRootFor(req.user.email);
    if (await this.storage.exists(ownPersonal)) {
      await appendVirtualTreeToArchive(archive, this.storage, ownPersonal, { skipPersonalAtRoot: false, manifest });
    }
    archive.append(JSON.stringify({ version: 1, entries: manifest }, null, 2), { name: 'manifest.json' });

    await archive.finalize();
  }

  @Get('headings')
  @RequiredScope('notes:read')
  async getHeadings(@Query('path') filePath: string, @Req() req: { user: JwtPayload }) {
    if (!filePath) throw new BadRequestException('path query parameter is required');
    let content: string;
    try {
      content = await this.filesService.readFile(filePath, req.user.email);
    } catch {
      throw new NotFoundException(`File not found: ${filePath}`);
    }
    const headings: { level: number; text: string }[] = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        headings.push({ level: match[1].length, text: match[2].trim() });
      }
    }
    return headings;
  }

  @Get('history')
  @RequiredScope('notes:read')
  async getHistory(@Query('path') path: string, @Req() req: Request & { user: JwtPayload }) {
    if (!path) throw new BadRequestException('path query parameter is required');
    // History rows hold past note content, so they get the same gates as a read.
    await this.pinService.assertUnlockedForRequest(req, path, req.user.email);
    await this.filesService.assertReadable(path, req.user.email);
    return this.versionHistory.getHistory(path);
  }

  @Get('version')
  @RequiredScope('notes:read')
  async getVersion(
    @Query('path') path: string,
    @Query('changeId') changeIdStr: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!path) throw new BadRequestException('path query parameter is required');
    if (!changeIdStr) throw new BadRequestException('changeId query parameter is required');
    const changeId = parseInt(changeIdStr, 10);
    if (isNaN(changeId)) throw new BadRequestException('changeId must be a number');
    await this.pinService.assertUnlockedForRequest(req, path, req.user.email);
    await this.filesService.assertReadable(path, req.user.email);
    return this.versionHistory.reconstructVersion(path, changeId);
  }

  @Post('restore')
  @RequiredScope('notes:edit')
  async restoreVersion(
    @Body() body: { path: string; changeId: number },
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!body.path) throw new BadRequestException('path is required');
    if (!body.changeId) throw new BadRequestException('changeId is required');
    await this.pinService.assertUnlockedForRequest(req, body.path, req.user.email);
    await this.filesService.assertWritable(body.path, req.user.email);

    const { content: historicalContent, partial } = await this.versionHistory.reconstructVersion(body.path, body.changeId);
    if (partial) {
      throw new UnprocessableEntityException('Cannot restore: version reconstruction failed due to corrupted diff chain');
    }

    const otService = this.getOTService();

    // Get current document state from OT session
    const session = otService.sessionManager.getSession(body.path);
    const currentContent = session?.content ?? '';
    const currentRevision = session ? otService.sessionManager.getRevision(body.path) : 0;

    if (currentContent === historicalContent) {
      return { success: true };
    }

    // Auto-snapshot current content before overwriting so user can "undo" via history
    await this.versionHistory.createPreRestoreSnapshot(body.path, currentContent, req.user.sub);

    // Build OT operation: delete all current content, insert historical content
    const ops: OTOperation = [];
    if (currentContent.length > 0) {
      ops.push({ type: 'delete', count: currentContent.length });
    }
    if (historicalContent.length > 0) {
      ops.push({ type: 'insert', text: historicalContent });
    }

    const result = await otService.applyOperation(body.path, ops, currentRevision, req.user.sub);
    if (!result) {
      throw new UnprocessableEntityException('Failed to apply restore operation through OT');
    }

    // Broadcast the operation to all connected clients
    const clients = otService.sessionManager.getClients(body.path);
    if (clients) {
      const message = JSON.stringify({
        type: 'op',
        docId: body.path,
        ops: result.ops,
        rev: result.revision,
      });
      for (const [ws] of clients) {
        if (ws.readyState === 1 /* WebSocket.OPEN */) {
          ws.send(message);
        }
      }
    }

    return { success: true };
  }
}
