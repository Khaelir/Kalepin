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
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { CombinedAuthGuard, JwtPayload, isAdmin } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { GrantsService } from './grants.service';
import { GrantPermission } from '../entities/document-grant.entity';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import { canonicalizeEmail } from '../auth/email';

interface MintBody {
  grantee_email: string;
  path: string;
  permission: GrantPermission;
  expires_at?: number | null;
}

@Controller('api/grants')
@UseGuards(CombinedAuthGuard)
export class GrantsController {
  constructor(
    private readonly grants: GrantsService,
    private readonly visibility: GrantAwareVisibility,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates,
  ) {}

  @Post()
  @RequiredScope('notes:edit')
  async mint(@Body() body: MintBody, @Req() req: { user: JwtPayload }) {
    if (!body || !body.grantee_email || !body.path || !body.permission) {
      throw new BadRequestException('grantee_email, path, and permission are required');
    }
    if (!['read', 'comment', 'write'].includes(body.permission)) {
      throw new BadRequestException('permission must be read, comment, or write');
    }
    if (this.predicates.isE2EEncrypted(body.path)) {
      throw new BadRequestException(
        `Cannot grant on E2E-encrypted path "${body.path}". Move the note out of _secure/ first, or wait for E2E sharing support (add-e2e-secure-subfolder).`,
      );
    }

    const grantorEmail = canonicalizeEmail(req.user.email);
    const granteeEmail = canonicalizeEmail(body.grantee_email);

    if (granteeEmail === grantorEmail) {
      throw new BadRequestException('Cannot grant a path to yourself');
    }

    // Visibility throws NotFoundException for non-owner — surfaces as 404,
    // which is the existing personal-folder convention.
    const v = await this.visibility.visibilityFor(body.path, grantorEmail);
    if (v.kind !== 'owner') {
      throw new ForbiddenException('Only the path owner can mint grants');
    }

    const grant = await this.grants.mint({
      grantorEmail,
      granteeEmail,
      path: body.path,
      permission: body.permission,
      expiresAt: body.expires_at ?? null,
    });
    return { id: grant.id };
  }

  @Patch(':id')
  @RequiredScope('notes:edit')
  async patch(
    @Param('id') idStr: string,
    @Body() body: { permission?: GrantPermission; expires_at?: number | null },
    @Req() req: { user: JwtPayload },
  ) {
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('id must be a positive integer');
    }
    if (body.permission !== undefined && !['read', 'comment', 'write'].includes(body.permission)) {
      throw new BadRequestException('permission must be read, comment, or write');
    }
    const grant = await this.grants.findById(id);
    if (!grant || grant.revokedAt !== null) {
      throw new NotFoundException('grant not found');
    }
    const requester = canonicalizeEmail(req.user.email);
    if (canonicalizeEmail(grant.grantorEmail) !== requester && !isAdmin(req.user.email)) {
      throw new ForbiddenException('Only the grantor or an admin can update');
    }
    const updated = await this.grants.update(id, {
      permission: body.permission,
      expiresAt: body.expires_at,
    });
    if (!updated) throw new NotFoundException('grant not found');
    return {
      id: updated.id,
      grantor_email: updated.grantorEmail,
      grantee_email: updated.granteeEmail,
      path: updated.path,
      permission: updated.permission,
      expires_at: updated.expiresAt,
      created_at: updated.createdAt,
    };
  }

  @Delete(':id')
  @RequiredScope('notes:edit')
  async revoke(@Param('id') idStr: string, @Req() req: { user: JwtPayload }) {
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('id must be a positive integer');
    }
    const grant = await this.grants.findById(id);
    if (!grant) {
      throw new BadRequestException('grant not found');
    }
    const requester = canonicalizeEmail(req.user.email);
    const isGrantor = canonicalizeEmail(grant.grantorEmail) === requester;
    if (!isGrantor && !isAdmin(req.user.email)) {
      throw new ForbiddenException('Only the grantor or an admin can revoke');
    }
    await this.grants.revoke(id);
    return { revoked: id };
  }

  @Get()
  @RequiredScope('notes:read')
  async list(
    @Query('as') as: string | undefined,
    @Query('path') pathFilter: string | undefined,
    @Req() req: { user: JwtPayload },
  ) {
    const email = canonicalizeEmail(req.user.email);

    // Per-note panel: caller passes ?path=… and must own the path. Returns
    // every active grant on that path (regardless of grantee).
    if (pathFilter) {
      const v = await this.visibility.visibilityFor(pathFilter, email);
      if (v.kind !== 'owner') {
        throw new ForbiddenException('Only the path owner can list grants for a path');
      }
      const rows = await this.grants.listForPath(pathFilter);
      return {
        as: 'path' as const,
        path: pathFilter,
        grants: rows.map((g) => ({
          id: g.id,
          grantor_email: g.grantorEmail,
          grantee_email: g.granteeEmail,
          path: g.path,
          permission: g.permission,
          expires_at: g.expiresAt,
          created_at: g.createdAt,
        })),
      };
    }

    const role = as === 'grantor' ? 'grantor' : 'grantee';
    const rows = role === 'grantor'
      ? await this.grants.listForGrantor(email)
      : await this.grants.listForGrantee(email);
    return {
      as: role,
      grants: rows.map((g) => ({
        id: g.id,
        grantor_email: g.grantorEmail,
        grantee_email: g.granteeEmail,
        path: g.path,
        permission: g.permission,
        expires_at: g.expiresAt,
        created_at: g.createdAt,
      })),
    };
  }
}
