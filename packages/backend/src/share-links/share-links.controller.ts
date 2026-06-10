import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  GoneException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CombinedAuthGuard } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { isVisibleTo } from '../auth/visibility';
import { isAdmin } from '../auth/admin.util';
import { ShareLinksService } from './share-links.service';
import { ScopedTokenService } from './scoped-token.service';
import { ShareLinkScopeGuard } from './share-link-scope.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { AnonymousRateLimitGuard, RateLimit } from './rate-limit.guard';
import {
  PinService,
  pinCookieName,
  readCookie,
  GRANTEE_TTL_SECONDS,
  PinLockedException,
} from '../pin';
import { AccessLogService } from '../access-log/access-log.service';
import { extractClientIp } from '../access-log/extract-ip';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { isE2EPath } from '../crypto/encryption-predicates';
import { AttachmentsService } from '../attachments';
import { rewriteMarkdownForGuest } from './asset-rewriter';
import { CommentsService } from '../comments/comments.service';
import { DocHandlesService } from '../doc-handles/doc-handles.service';

const PERSONAL_PREFIX = '_users/';
const DAY_MS = 24 * 60 * 60 * 1000;

function envInt(name: string): number | null | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  if (raw.toLowerCase() === 'null' || raw.toLowerCase() === 'never') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Resolve the default ttl for a path. Personal-folder paths get 30 days by
 * default; shared-vault paths get null (never). Both are overridable via env. */
function defaultTtlForPath(path: string): number | null {
  const isPersonal = path.startsWith(PERSONAL_PREFIX);
  if (isPersonal) {
    const envValue = envInt('SHARE_LINK_DEFAULT_TTL_MS_PERSONAL');
    return envValue === undefined ? 30 * DAY_MS : envValue;
  }
  const envValue = envInt('SHARE_LINK_DEFAULT_TTL_MS_SHARED');
  return envValue === undefined ? null : envValue;
}

/**
 * Synthetic identity used when an unauthenticated viewer arrives via a share
 * link. Never associated with a real user record — purely a stable string the
 * PIN unlock token can be keyed against.
 */
export function anonymousIdentityFor(code: string): string {
  return `anonymous-${code}`;
}

@Controller('api/share-links')
export class ShareLinksController {
  constructor(
    private readonly shareLinksService: ShareLinksService,
    private readonly pinService: PinService,
    private readonly visibility: GrantAwareVisibility,
    private readonly accessLog: AccessLogService,
    private readonly tokens: ScopedTokenService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly attachments: AttachmentsService,
    @Inject(forwardRef(() => CommentsService))
    private readonly comments: CommentsService,
    private readonly docHandles: DocHandlesService,
  ) {}

  // ── Authenticated routes ──────────────────────────────────────────────

  @Post()
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('notes:read')
  async create(
    @Body() body: {
      path: string;
      ttl_ms?: number | null;
      allow_guest_comments?: boolean;
    },
    @Req() req: any,
  ) {
    if (!body.path) throw new BadRequestException('path is required');
    const email = req.user.email.toLowerCase();
    // Public-link minting is a re-share action: a read-only grantee should not
    // be able to expose a file to the world. Gate on write — owners + write
    // grantees + admins. Foreign-personal paths still 404 via NotFoundException.
    await this.visibility.assertWritableBy(body.path, email);

    // Resolve the effective TTL: explicit ttl_ms wins, otherwise apply the
    // path-class default (personal = 30d, shared = never).
    const ttlMs =
      body.ttl_ms === undefined ? defaultTtlForPath(body.path) : body.ttl_ms;

    try {
      const { code } = await this.shareLinksService.mintExplicit({
        path: body.path,
        ttlMs,
        createdByEmail: email,
        allowGuestComments: body.allow_guest_comments === true,
      });
      return { code };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new NotFoundException('File not found');
    }
  }

  /** Update a setting on an existing share link without re-minting. Today
   * only `allow_guest_comments` is mutable. Same gate as revoke: creator or
   * admin (legacy null-creator rows fall back to path-owner). */
  @Patch(':code')
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('notes:edit')
  async updateLink(
    @Param('code') code: string,
    @Body() body: { allow_guest_comments?: boolean },
    @Req() req: any,
  ) {
    const email = req.user.email.toLowerCase();
    const info = await this.shareLinksService.infoForCodeIncludingGone(code);
    if (!info) throw new NotFoundException('Code not found');

    const isCreator =
      info.createdByEmail !== null &&
      info.createdByEmail.toLowerCase() === email;
    const legacyOwnerFallback =
      info.createdByEmail === null && isVisibleTo(info.path, email);
    if (!isAdmin(email) && !isCreator && !legacyOwnerFallback) {
      throw new ForbiddenException('Only the link creator or an admin may update this link');
    }

    if (typeof body.allow_guest_comments === 'boolean') {
      await this.shareLinksService.setAllowGuestComments(code, body.allow_guest_comments);
    }
    return { ok: true };
  }

  @Delete(':code')
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('notes:edit')
  async revoke(@Param('code') code: string, @Req() req: any) {
    const email = req.user.email.toLowerCase();
    // Look up the row directly (active or gone) so we have both `path` and
    // `createdByEmail` for the gating decision. resolve() hides path on gone
    // rows; that abstraction is right for read flows, wrong here.
    const info = await this.shareLinksService.infoForCodeIncludingGone(code);
    if (!info) throw new NotFoundException('Code not found');

    const isCreator =
      info.createdByEmail !== null &&
      info.createdByEmail.toLowerCase() === email;
    // Legacy auto-minted rows have createdByEmail=null. Those can be revoked
    // only by an admin or the path's owner — the original revoke gate, kept
    // as a fallback so legacy links remain manageable.
    const legacyOwnerFallback =
      info.createdByEmail === null && isVisibleTo(info.path, email);

    if (!isAdmin(email) && !isCreator && !legacyOwnerFallback) {
      throw new ForbiddenException('Only the link creator or an admin may revoke');
    }
    await this.shareLinksService.revoke(code);
    return { ok: true };
  }

  @Get('by-path')
  @UseGuards(CombinedAuthGuard)
  @RequiredScope('notes:read')
  async byPath(@Query('path') path: string, @Req() req: any) {
    if (!path) throw new BadRequestException('path is required');
    const email = req.user.email.toLowerCase();
    if (!isAdmin(email) && !isVisibleTo(path, email)) {
      throw new NotFoundException();
    }
    const link = await this.shareLinksService.findByPath(path);
    // Nest's Express adapter sends an empty body when a controller returns
    // null, which crashes the frontend's `res.json()` ("Unexpected end of
    // JSON input"). Surface the "no row" case as 404 instead — the frontend
    // already maps 404 → null in findShareLinkByPath.
    if (!link) throw new NotFoundException();
    return link;
  }

  // ── Anonymous-friendly routes ─────────────────────────────────────────

  /**
   * Resolve a share code to its target path and (when the link is healthy)
   * issue a scoped access token the caller can then present to
   * `:code/content` to read the file.
   *
   * Tolerates anonymous callers via OptionalAuthGuard; never associates a
   * session identity with the issued token. PIN-protected paths surface
   * `requiresPin: true` and omit the access token until the viewer has
   * unlocked through `:code/pin/verify`.
   */
  @Get('resolve/:code')
  @UseGuards(OptionalAuthGuard, AnonymousRateLimitGuard)
  @RateLimit({ max: 30, windowMs: 60_000, name: 'share-resolve' })
  async resolve(
    @Param('code') code: string,
    @Req() req: Request & { user?: any },
  ) {
    const result = await this.shareLinksService.resolve(code);
    if (result.kind === 'not_found') throw new NotFoundException('Code not found');
    if (result.kind === 'gone') {
      throw new GoneException(
        result.reason === 'revoked'
          ? 'This share link has been revoked'
          : 'This share link has expired',
      );
    }
    const path = result.path;

    // Pull creator email + future flags (allowGuestComments lands in Phase D)
    // from the same row; we already have one query.
    const info = await this.shareLinksService.infoForCodeIncludingGone(code);

    // Mint the handle now (lazy) so the resolve response carries it. This is
    // the natural moment for a server-authed read of `path` to ensure a row
    // exists — otherwise the frontend would have to chain a /api/files/read
    // just to learn the id. Idempotent on subsequent resolves.
    const handleId = await this.docHandles.findOrCreateForPath(path);

    // PIN gate: don't issue a content access token until the viewer has
    // unlocked. The frontend renders the PIN prompt and re-resolves.
    if (await this.pinService.hasPin(path)) {
      const viewerIdentity = req.user?.email
        ? req.user.email.toLowerCase()
        : anonymousIdentityFor(code);
      const cookieToken = readShareCookie(req, path);
      const headerToken = readUnlockHeader(req);
      const cookieValid =
        !!cookieToken &&
        !!this.pinService.validateUnlockToken(cookieToken, path, viewerIdentity);
      const headerValid =
        !!headerToken &&
        !!this.pinService.validateUnlockToken(headerToken, path, viewerIdentity);
      if (!cookieValid && !headerValid) {
        return {
          path,
          handleId,
          sharedByEmail: info?.createdByEmail ?? null,
          allowGuestComments: !!info?.allow_guest_comments,
          requiresPin: true,
        };
      }
    }

    // The spec records share-link resolves with viewer='anonymous'. Recipients
    // arriving via a share link are not necessarily authenticated even when a
    // session exists (the link itself is the access path); using their session
    // email here would skew the owner's view of who actually arrived through
    // the share.
    void this.accessLog.record(path, 'anonymous', 'share-link-resolved', extractClientIp(req));

    const { token: accessToken, expiresAt: accessTokenExpiresAt } =
      this.tokens.mintAccessToken({ code, path });
    return {
      path,
      handleId,
      sharedByEmail: info?.createdByEmail ?? null,
      allowGuestComments: !!info?.allow_guest_comments,
      accessToken,
      accessTokenExpiresAt,
    };
  }

  /**
   * Anonymous-friendly file content endpoint, gated by the scoped access token
   * issued by `resolve`. Authenticated users normally use `/api/files/read`;
   * this route exists so guests can read shared content without a session.
   *
   * `req.shareLinkContext` is set by ShareLinkScopeGuard to `(code, path)`
   * — the path here is the trusted one. `:code` is the URL slug for routing
   * symmetry only; the guard already verified it matches the token.
   */
  @Get(':code/content')
  @UseGuards(ShareLinkScopeGuard, AnonymousRateLimitGuard)
  @RateLimit({ max: 60, windowMs: 60_000, name: 'share-content' })
  async content(
    @Param('code') code: string,
    @Req() req: Request & { shareLinkContext?: { code: string; path: string } },
  ) {
    const ctx = req.shareLinkContext;
    if (!ctx) throw new ForbiddenException('Missing share-link context');

    // Confirm the link is still active. The token has its own TTL but a
    // revoke that happened *after* mint must take effect immediately.
    const result = await this.shareLinksService.resolve(code);
    if (result.kind === 'not_found') throw new NotFoundException('Code not found');
    if (result.kind === 'gone') {
      throw new GoneException(
        result.reason === 'revoked'
          ? 'This share link has been revoked'
          : 'This share link has expired',
      );
    }
    if (result.path !== ctx.path) {
      // Defence in depth: token path and live row path drift means the file
      // moved or someone replayed an old token. Refuse rather than serve.
      throw new ForbiddenException('Path mismatch for share-link');
    }

    // PIN gate — keyed off the synthetic anonymous identity for this code.
    if (await this.pinService.hasPin(ctx.path)) {
      const viewerIdentity = anonymousIdentityFor(code);
      const cookieToken = readShareCookie(req, ctx.path);
      const headerToken = readUnlockHeader(req);
      const cookieValid =
        !!cookieToken &&
        !!this.pinService.validateUnlockToken(cookieToken, ctx.path, viewerIdentity);
      const headerValid =
        !!headerToken &&
        !!this.pinService.validateUnlockToken(headerToken, ctx.path, viewerIdentity);
      if (!cookieValid && !headerValid) {
        throw new PinLockedException(ctx.path);
      }
    }

    if (isE2EPath(ctx.path)) {
      // E2E paths cannot be share-linked at mint time; the in-flight check
      // exists to fail loudly if a row somehow slipped through.
      throw new BadRequestException('end-to-end encrypted paths cannot be share-linked');
    }

    let content: string;
    try {
      content = await this.storage.read(ctx.path);
    } catch {
      throw new NotFoundException('File not found');
    }

    // Rewrite attachment refs so the guest's browser dispatches asset fetches
    // through `/api/share-links/:code/asset` (scoped-token-gated) instead of
    // resolving them as relative URLs the guest origin can't authenticate.
    const rewritten = rewriteMarkdownForGuest(content, code, this.tokens);

    void this.accessLog.record(ctx.path, 'anonymous', 'view', extractClientIp(req));
    return { path: ctx.path, content: rewritten };
  }

  /**
   * Serve a single attachment referenced by a shared note. Validated by a
   * per-asset HMAC token issued at content-rewrite time, NOT by the share-
   * link access token: this keeps each asset URL independently revocable
   * (different exp) and prevents an access token from being replayed as
   * proof of access to arbitrary assets.
   */
  @Get(':code/asset')
  @UseGuards(AnonymousRateLimitGuard)
  @RateLimit({ max: 240, windowMs: 60_000, name: 'share-asset' })
  async asset(
    @Param('code') code: string,
    @Query('name') name: string,
    @Query('st') signedToken: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!name) throw new BadRequestException('name is required');
    if (!signedToken) throw new BadRequestException('st is required');

    const verified = this.tokens.verifyAssetToken(signedToken);
    if (!verified || verified.code !== code || verified.assetPath !== name) {
      throw new ForbiddenException('Invalid asset token');
    }

    // Re-check share-link health on every asset fetch so a revocation takes
    // effect immediately even for already-rendered guest pages still loading
    // images.
    const result = await this.shareLinksService.resolve(code);
    if (result.kind === 'not_found') throw new NotFoundException('Code not found');
    if (result.kind === 'gone') {
      throw new GoneException(
        result.reason === 'revoked'
          ? 'This share link has been revoked'
          : 'This share link has expired',
      );
    }

    const { buffer, contentType } = await this.attachments.serveForShareLink(
      name,
      result.path,
    );
    res.set('Content-Type', contentType);
    // Tight cache headers: assets are HMAC-signed with an expiry, so we let
    // browsers cache for a short window but never beyond the token's life.
    res.set('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  }

  /**
   * Anonymous-friendly comment posting for share-links that opted into guest
   * comments. The author email is unverified (the guest typed it) — we
   * persist it as a *display label*, never associate it with a real user
   * record, and never trigger mention notifications. Refuses to write when
   * the link's `allow_guest_comments` flag is off.
   */
  @Post(':code/comments')
  @UseGuards(ShareLinkScopeGuard, AnonymousRateLimitGuard)
  @RateLimit({ max: 5, windowMs: 60_000, name: 'share-comment' })
  async postGuestComment(
    @Param('code') code: string,
    @Body() body: {
      blockId?: string;
      threadId?: string;
      authorEmail?: string;
      authorName?: string;
      text?: string;
      quotedText?: string;
      positionHint?: { from: number; to: number };
    },
    @Req() req: Request & { shareLinkContext?: { code: string; path: string } },
  ) {
    const ctx = req.shareLinkContext;
    if (!ctx) throw new ForbiddenException('Missing share-link context');
    if (!body.text || typeof body.text !== 'string' || body.text.length === 0) {
      throw new BadRequestException('text is required');
    }
    if (!body.authorEmail || !body.authorName) {
      throw new BadRequestException('authorEmail and authorName are required');
    }
    if (body.text.length > 10_000) {
      throw new BadRequestException('text exceeds 10KB');
    }
    if (body.authorName.length > 200 || body.authorEmail.length > 320) {
      throw new BadRequestException('author fields exceed allowed length');
    }
    // Format-validate but never *verify*. The email is purely a label.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.authorEmail)) {
      throw new BadRequestException('authorEmail must be a syntactically valid email');
    }

    if (!(await this.shareLinksService.guestCommentingAllowed(code))) {
      throw new ForbiddenException(
        'Guest commenting is not enabled for this share link',
      );
    }

    if (body.threadId) {
      // Reply to existing thread.
      if (!body.blockId) {
        throw new BadRequestException('blockId is required when replying');
      }
      const comment = await this.comments.replyToGuestThread(
        ctx.path,
        body.blockId,
        body.threadId,
        body.authorEmail,
        body.authorName,
        body.text,
      );
      void this.accessLog.record(ctx.path, 'anonymous', 'comment', extractClientIp(req));
      return { comment };
    }

    // New thread.
    if (!body.blockId) throw new BadRequestException('blockId is required');
    const result = await this.comments.addGuestComment(
      ctx.path,
      body.blockId,
      body.authorEmail,
      body.authorName,
      body.text,
      body.quotedText,
      body.positionHint,
    );
    void this.accessLog.record(ctx.path, 'anonymous', 'comment', extractClientIp(req));
    return result;
  }

  /**
   * Anonymous-friendly PIN unlock for a share-link. Keyed off the synthetic
   * `anonymous-<code>` identity so the token doesn't double as a credential
   * for any real account.
   */
  @Post(':code/pin/verify')
  @UseGuards(AnonymousRateLimitGuard)
  @RateLimit({ max: 10, windowMs: 60_000, name: 'share-pin-verify' })
  async verifyPinAnonymous(
    @Param('code') code: string,
    @Body() body: { pin: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body || typeof body.pin !== 'string') {
      throw new BadRequestException('pin is required');
    }
    const result = await this.shareLinksService.resolve(code);
    if (result.kind === 'not_found') throw new NotFoundException('Code not found');
    if (result.kind === 'gone') {
      throw new GoneException(
        result.reason === 'revoked'
          ? 'This share link has been revoked'
          : 'This share link has expired',
      );
    }
    const path = result.path;
    const viewerIdentity = anonymousIdentityFor(code);
    // Per-IP rate-limit bucket: a single bad-actor IP burning attempts on a
    // share link only locks itself out, not the owner or other guests. With
    // `trust proxy` set in main.ts, req.ip resolves the X-Forwarded-For
    // client when behind Traefik.
    const clientIp = (req.ip ?? (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ?? 'unknown') as string;
    const verifyResult = await this.pinService.verifyPin(
      path,
      body.pin,
      viewerIdentity,
      'share-viewer',
      `ip:${clientIp}`,
    );

    if (!verifyResult.ok) {
      if (verifyResult.lockoutUntil) throw new PinLockedException(path);
      throw new BadRequestException({
        error: 'wrong-pin',
        remainingAttempts: verifyResult.remainingAttempts ?? 0,
      });
    }

    res.cookie(verifyResult.cookieName!, verifyResult.token!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: (verifyResult.ttlSeconds ?? GRANTEE_TTL_SECONDS) * 1000,
      path: '/',
    });
    return {
      ok: true,
      expiresIn: verifyResult.ttlSeconds,
      // Surface the token in the body too so non-cookie clients (e.g. the
      // guest-mode SPA running cross-origin in dev) can stash it for the
      // x-kalepin-unlock header.
      unlockToken: verifyResult.token,
    };
  }
}

function readShareCookie(
  req: { headers: { cookie?: string } },
  path: string,
): string | null {
  return readCookie(req, pinCookieName(path));
}

function readUnlockHeader(req: { headers: Record<string, unknown> }): string | null {
  const raw = req.headers['x-kalepin-unlock'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return (raw[0] as string) ?? null;
  return null;
}
