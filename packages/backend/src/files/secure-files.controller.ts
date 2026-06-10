import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { CombinedAuthGuard, JwtPayload } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { SecureFilesService } from './secure-files.service';

@Controller('api/files')
@UseGuards(CombinedAuthGuard)
export class SecureFilesController {
  constructor(private readonly secureFiles: SecureFilesService) {}

  /**
   * One-shot read of a non-`_secure/` file the owner is preparing to move into
   * `_secure/`. Returns plaintext and a short-lived signed token; the token is
   * required by `POST /api/files/move-to-secure` and may only be redeemed once.
   */
  @Get('secure/cek-handoff')
  @RequiredScope('notes:read')
  async cekHandoff(
    @Query('path') filePath: string,
    @Req() req: { user: JwtPayload },
  ) {
    if (!filePath) throw new BadRequestException('path query parameter is required');
    return this.secureFiles.issueHandoff(filePath, req.user.email);
  }

  /**
   * Read the raw envelope bytes for an E2E file. The server cannot decrypt
   * (path is owned by `ClientKEKSource`); the client unwraps the CEK with the
   * cached master-KEK and decrypts locally.
   */
  @Get('secure/read')
  @RequiredScope('notes:read')
  async readSecure(@Query('path') filePath: string, @Req() req: { user: JwtPayload }) {
    if (!filePath) throw new BadRequestException('path query parameter is required');
    return this.secureFiles.readSecureBytes(filePath, req.user.email);
  }

  /**
   * Routine save of an existing E2E file. The body carries a v1 envelope
   * (kdf=Argon2id) whose AAD `path` must match the request path. The server
   * validates magic + AAD and writes through the encrypting adapter, which
   * passes the bytes to disk untouched.
   */
  @Post('secure/write')
  @RequiredScope('notes:edit')
  async writeSecure(@Body() body: { path: string; envelope: string }, @Req() req: { user: JwtPayload }) {
    if (!body || typeof body.path !== 'string' || typeof body.envelope !== 'string') {
      throw new BadRequestException('path and envelope are required');
    }
    return this.secureFiles.writeSecureBytes({
      path: body.path,
      envelopeBase64: body.envelope,
      userEmail: req.user.email,
    });
  }

  /** Create a new E2E file (rejects when destination already exists). */
  @Post('secure/create')
  @RequiredScope('notes:create')
  async createSecure(@Body() body: { path: string; envelope: string }, @Req() req: { user: JwtPayload }) {
    if (!body || typeof body.path !== 'string' || typeof body.envelope !== 'string') {
      throw new BadRequestException('path and envelope are required');
    }
    return this.secureFiles.createSecure({
      path: body.path,
      envelopeBase64: body.envelope,
      userEmail: req.user.email,
    });
  }

  /**
   * Move a personal note from a plaintext path into `_secure/`. The body's
   * `encryptedEnvelope` is the client-built v1 envelope (kdf=Argon2id) whose
   * AAD `path` defines the destination. The endpoint also revokes all grants,
   * deletes share-links, and clears the PIN on the source path before the swap.
   */
  @Post('move-to-secure')
  @RequiredScope('notes:edit')
  async moveToSecure(
    @Body() body: { src: string; encryptedEnvelope: string; handoffToken: string },
    @Req() req: { user: JwtPayload },
  ) {
    if (!body || typeof body.src !== 'string' || typeof body.encryptedEnvelope !== 'string' || typeof body.handoffToken !== 'string') {
      throw new BadRequestException('src, encryptedEnvelope, and handoffToken are required');
    }
    return this.secureFiles.moveToSecure({
      src: body.src,
      encryptedEnvelopeBase64: body.encryptedEnvelope,
      handoffToken: body.handoffToken,
      userEmail: req.user.email,
    });
  }

  /**
   * Move a note out of `_secure/`. The client has already decrypted using the
   * cached master-KEK; this endpoint writes the plaintext at the destination
   * (where the at-rest encrypting adapter envelopes it under the server KEK).
   */
  @Post('move-from-secure')
  @RequiredScope('notes:edit')
  async moveFromSecure(
    @Body() body: { src: string; dest: string; content: string },
    @Req() req: { user: JwtPayload },
  ) {
    if (!body || typeof body.src !== 'string' || typeof body.dest !== 'string' || typeof body.content !== 'string') {
      throw new BadRequestException('src, dest, and content are required');
    }
    return this.secureFiles.moveFromSecure({
      src: body.src,
      dest: body.dest,
      plaintext: body.content,
      userEmail: req.user.email,
    });
  }
}
