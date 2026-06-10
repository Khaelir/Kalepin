import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  Inject,
  BadRequestException,
  ForbiddenException,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { isUnderPersonalRoot, personalRootFor } from '../auth/visibility';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import {
  PinService,
  PinLockedException,
  pinCookieName,
  GRANTEE_TTL_SECONDS,
  ONE_SHOT_TTL_SECONDS,
} from './pin.service';

/**
 * Express has already URL-decoded the route param by the time we see it.
 * We only canonicalize and reject anything that would let the caller poke at
 * sibling notes via traversal.
 */
function canonicalizePath(raw: string): string {
  if (!raw || raw.includes('..') || raw.startsWith('/')) {
    throw new BadRequestException('invalid path');
  }
  return raw;
}

/**
 * Owner predicate: the requester owns the path if it sits under their personal
 * root, OR the path is a non-personal (shared) path — anyone with write access
 * to the shared zone is treated as an owner there. This matches how
 * visibility.ts treats writes.
 */
function isOwnerOf(path: string, email: string): boolean {
  if (isUnderPersonalRoot(path)) {
    const root = personalRootFor(email);
    return path === root || path.startsWith(root + '/');
  }
  return true;
}

@Controller('api/notes')
@UseGuards(CombinedAuthGuard)
export class PinController {
  constructor(
    private readonly pinService: PinService,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates,
  ) {}

  @Post(':path/pin')
  @RequiredScope('notes:edit')
  @HttpCode(204)
  async setPin(
    @Param('path') rawPath: string,
    @Body() body: { pin: string },
    @Req() req: { user: JwtPayload },
  ): Promise<void> {
    const path = canonicalizePath(rawPath);
    const email = req.user.email.toLowerCase();
    if (!isOwnerOf(path, email)) {
      throw new ForbiddenException('only the owner can set a PIN');
    }
    if (this.predicates.isE2EEncrypted(path)) {
      throw new BadRequestException(
        'The PIN is a server-side gate. End-to-end encrypted notes (under _secure/) are protected by your passphrase, not by a PIN.',
      );
    }
    if (!body || typeof body.pin !== 'string') {
      throw new BadRequestException('pin is required');
    }
    await this.pinService.setPin(path, body.pin, email);
  }

  @Delete(':path/pin')
  @RequiredScope('notes:edit')
  @HttpCode(204)
  async removePin(
    @Param('path') rawPath: string,
    @Req() req: { user: JwtPayload },
  ): Promise<void> {
    const path = canonicalizePath(rawPath);
    const email = req.user.email.toLowerCase();
    if (!isOwnerOf(path, email)) {
      throw new ForbiddenException('only the owner can remove the PIN');
    }
    await this.pinService.removePin(path);
  }

  @Post(':path/pin/verify')
  @RequiredScope('notes:read')
  async verifyPin(
    @Param('path') rawPath: string,
    @Body() body: { pin: string; oneShot?: boolean },
    @Req() req: { user: JwtPayload },
    @Res({ passthrough: true }) res: Response,
  ) {
    const path = canonicalizePath(rawPath);
    const email = req.user.email.toLowerCase();
    if (!body || typeof body.pin !== 'string') {
      throw new BadRequestException('pin is required');
    }

    const kind = isOwnerOf(path, email) ? 'owner' : 'grantee';
    const result = await this.pinService.verifyPin(
      path,
      body.pin,
      email,
      body.oneShot ? 'one-shot' : kind,
    );

    if (!result.ok) {
      if (result.lockoutUntil) {
        throw new PinLockedException(path);
      }
      // 401 wrong PIN; surface remainingAttempts so the UI can show a counter.
      throw new BadRequestException({
        error: 'wrong-pin',
        remainingAttempts: result.remainingAttempts ?? 0,
      });
    }

    // One-shot tokens are returned in the body for header use (MCP). Cookie
    // tokens are issued for browser use.
    if (body.oneShot) {
      return { token: result.token, expiresIn: ONE_SHOT_TTL_SECONDS };
    }

    res.cookie(result.cookieName!, result.token!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: (result.ttlSeconds ?? GRANTEE_TTL_SECONDS) * 1000,
      path: '/',
    });
    return { ok: true, expiresIn: result.ttlSeconds };
  }

  @Post('pin/list')
  @RequiredScope('notes:read')
  async listMyPinned(@Req() req: { user: JwtPayload }) {
    return { items: await this.pinService.listLockedFor(req.user.email.toLowerCase()) };
  }
}

export { pinCookieName };
