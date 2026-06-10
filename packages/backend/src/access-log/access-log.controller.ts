import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { isAdmin } from '../auth/admin.util';
import { isVisibleTo } from '../auth/visibility';
import { canonicalizeEmail } from '../auth/email';
import { AccessLogService } from './access-log.service';
import { GrantsService } from '../grants/grants.service';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';

@Controller('api')
@UseGuards(CombinedAuthGuard)
export class AccessLogController {
  constructor(
    private readonly accessLog: AccessLogService,
    private readonly grants: GrantsService,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates,
  ) {}

  /**
   * Owner-or-admin read of the access log for a single path.
   *
   * The path is URL-encoded in the route param (e.g. `_users%2Falice%2Ffoo.md`)
   * because Nest's wildcard routing would otherwise eat slashes and break
   * `_users/...` paths. This matches the spec's example URL.
   */
  @Get('notes/:path/access-log')
  @RequiredScope('notes:read')
  async listForPath(
    @Param('path') encodedPath: string,
    @Query('since') sinceStr: string | undefined,
    @Query('limit') limitStr: string | undefined,
    @Req() req: Request & { user: JwtPayload },
  ) {
    const path = decodeURIComponent(encodedPath);
    const email = req.user.email.toLowerCase();
    if (!isAdmin(email) && !isVisibleTo(path, email)) {
      throw new ForbiddenException('Owner or admin only');
    }
    const since = parseOptionalInt(sinceStr);
    const limit = parseOptionalInt(limitStr) ?? 100;
    const rows = await this.accessLog.listForPath(path, since, limit);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        viewer_email: r.viewerEmail,
        action: r.action,
        ts: r.ts,
        ip_hash: r.ipHash,
      })),
    };
  }

  /**
   * Owner-or-admin aggregate of access activity for a single path. Used by the
   * share dialog to show per-grantee view counts and last-viewed-ago, plus the
   * anonymous public-link aggregate. Filters revoked grantees and the owner's
   * own self-views by intersecting with the active-grants list.
   */
  @Get('notes/:path/access-summary')
  @RequiredScope('notes:read')
  async summaryForPath(
    @Param('path') encodedPath: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    const path = decodeURIComponent(encodedPath);
    const email = req.user.email.toLowerCase();
    if (!isAdmin(email) && !isVisibleTo(path, email)) {
      throw new ForbiddenException('Owner or admin only');
    }
    const activeGrants = await this.grants.listForPath(path);
    const granteeEmails = activeGrants.map((g) => g.granteeEmail.toLowerCase());
    const isE2E = this.predicates.isE2EEncrypted(path);
    const summary = await this.accessLog.summaryForPath(path, granteeEmails, {
      includeAnonymous: !isE2E,
    });
    return {
      grantees: summary.rows.map((r) => ({
        email: r.email,
        view_count: r.view_count,
        last_view_at: r.last_view_at,
        last_edit_at: r.last_edit_at,
      })),
      anonymous: summary.anonymous,
    };
  }

  @Delete('users/me/access-log')
  @RequiredScope('notes:edit')
  async eraseMine(@Req() req: Request & { user: JwtPayload }) {
    const email = canonicalizeEmail(req.user.email);
    const deleted = await this.accessLog.deleteForViewer(email);
    return { deleted };
  }

  @Delete('admin/users/:email/access-log')
  @RequiredScope('users:read')
  async eraseForUser(
    @Param('email') targetEmail: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!isAdmin(req.user.email)) {
      throw new ForbiddenException('Admin only');
    }
    let canonical: string;
    try {
      canonical = canonicalizeEmail(decodeURIComponent(targetEmail));
    } catch {
      throw new BadRequestException('Invalid email');
    }
    const deleted = await this.accessLog.deleteForViewer(canonical);
    return { deleted };
  }
}

function parseOptionalInt(s: string | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}
