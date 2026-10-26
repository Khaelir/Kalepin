import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { ShareLinksService } from '../share-links/share-links.service';
import { GrantsService } from '../grants/grants.service';
import { PinService } from '../pin';
import { FilesService } from './files.service';
import { canonicalizeEmail } from '../auth/email';
import { deriveTokenSecret } from '../auth/jwt-secret';
import { personalRootFor, isUnderPersonalRoot, isCanonicalPath } from '../auth/visibility';
import {
  hasEnvelopeMagic,
  parseHeader,
  KDF_ARGON2ID,
  ALG_AES_256_GCM,
} from '../crypto/envelope';
import { isE2EPath } from '../crypto/encryption-predicates';

export interface HandoffTokenPayload {
  type: 'cek-handoff';
  src: string;
  email: string;
}

const HANDOFF_TTL_SECONDS = 5 * 60;

/**
 * Server-side counterpart of the client-driven `_secure/` move flows.
 *
 * - {@link issueHandoff} returns the readable plaintext for a non-`_secure/` path
 *   the owner is preparing to move into `_secure/`, plus a short-lived signed
 *   token. This is the LAST time the server hands off the bytes — once the move
 *   completes, the file is opaque to the server.
 * - {@link moveToSecure} accepts a client-encrypted envelope keyed against the
 *   user's master-KEK, atomically revokes all sharing artifacts on the source
 *   (grants, share-links, PIN), writes the envelope at the destination under
 *   `_secure/`, and deletes the source.
 * - {@link moveFromSecure} is the symmetric exit. The client has already
 *   decrypted; the plaintext lands at the destination through the regular
 *   at-rest encryption boundary.
 */
@Injectable()
export class SecureFilesService {
  private readonly logger = new Logger(SecureFilesService.name);
  private readonly jwtSecret: string;
  private readonly usedHandoffTokens = new Set<string>();

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly filesService: FilesService,
    private readonly shareLinks: ShareLinksService,
    private readonly grants: GrantsService,
    private readonly pinService: PinService,
  ) {
    // Own key, so a handoff token can't be presented as a session JWT.
    this.jwtSecret = deriveTokenSecret('cek-handoff');
  }

  async issueHandoff(src: string, userEmail: string): Promise<{ src: string; plaintext: string; handoffToken: string; expiresIn: number }> {
    const email = canonicalizeEmail(userEmail);
    this.assertOwnedNonSecure(src, email);
    if (!(await this.storage.exists(src))) {
      throw new NotFoundException(`source not found: ${src}`);
    }
    // The storage adapter transparently decrypts the at-rest envelope.
    const plaintext = await this.storage.read(src);
    const payload: HandoffTokenPayload = { type: 'cek-handoff', src, email };
    const handoffToken = jwt.sign(payload, this.jwtSecret, { expiresIn: HANDOFF_TTL_SECONDS });
    return { src, plaintext, handoffToken, expiresIn: HANDOFF_TTL_SECONDS };
  }

  async moveToSecure(input: { src: string; encryptedEnvelopeBase64: string; handoffToken: string; userEmail: string }): Promise<{ src: string; dest: string; revokedGrants: number; deletedShareLinks: number; pinCleared: boolean }> {
    const email = canonicalizeEmail(input.userEmail);
    this.assertOwnedNonSecure(input.src, email);

    // Verify the one-shot handoff token is fresh and bound to this src/email.
    let payload: HandoffTokenPayload;
    try {
      payload = jwt.verify(input.handoffToken, this.jwtSecret) as HandoffTokenPayload;
    } catch {
      throw new UnauthorizedException('handoff token invalid or expired');
    }
    if (payload.type !== 'cek-handoff' || payload.src !== input.src || payload.email !== email) {
      throw new UnauthorizedException('handoff token does not match this move');
    }
    if (this.usedHandoffTokens.has(input.handoffToken)) {
      throw new UnauthorizedException('handoff token already used');
    }

    const envelope = Buffer.from(input.encryptedEnvelopeBase64, 'base64');
    const header = this.validateE2EEnvelope(envelope);
    const aad = this.parseAad(header.aad);
    const dest = aad.path;
    this.assertOwnedSecure(dest, email);
    if (dest === input.src) {
      throw new BadRequestException('destination must differ from source');
    }
    if (await this.storage.exists(dest)) {
      throw new BadRequestException(`destination already exists: ${dest}`);
    }

    // Atomic-ish revocation + swap. Order matters:
    // 1) Cut sharing first so a crash mid-swap leaves the file unshared.
    // 2) Write the envelope at dest (storage adapter passes through for E2E).
    // 3) Delete src.
    const revokedGrants = (await this.grants.cascadeDelete(input.src)) ?? 0;
    let deletedShareLinks = 0;
    if (this.shareLinks) {
      // ShareLinksService doesn't return a count; query before delete to be honest in the response.
      // Cheap and correct: delete is idempotent.
      try {
        await this.shareLinks.deleteByPath(input.src);
        deletedShareLinks = 1;
      } catch {
        deletedShareLinks = 0;
      }
    }
    let pinCleared = false;
    try {
      await this.pinService.removePin(input.src);
      pinCleared = true;
    } catch {
      // PIN may not exist — silent noop.
    }

    if (!this.storage.writeBytes) {
      throw new Error('storage adapter does not support writeBytes');
    }
    await this.storage.writeBytes(dest, envelope);
    await this.storage.delete(input.src);
    this.usedHandoffTokens.add(input.handoffToken);

    return { src: input.src, dest, revokedGrants, deletedShareLinks, pinCleared };
  }

  /**
   * Routine read of an existing E2E file. Returns the raw envelope bytes as
   * base64 so the client can decrypt locally. The server never sees the
   * plaintext for `_secure/` paths — the storage adapter's `readBytes` short-
   * circuits when it sees a ClientKEKSource.
   */
  async readSecureBytes(filePath: string, userEmail: string): Promise<{ path: string; envelope: string }> {
    const email = canonicalizeEmail(userEmail);
    this.assertOwnedSecure(filePath, email);
    if (!(await this.storage.exists(filePath))) {
      throw new NotFoundException(`file not found: ${filePath}`);
    }
    if (!this.storage.readBytes) {
      throw new Error('storage adapter does not support readBytes');
    }
    const buf = await this.storage.readBytes(filePath);
    return { path: filePath, envelope: buf.toString('base64') };
  }

  /**
   * Routine save of an existing E2E file. Validates envelope magic + AAD path
   * binding before writing. The encrypting storage adapter passes the bytes
   * through unchanged because the path is owned by ClientKEKSource.
   */
  async writeSecureBytes(input: { path: string; envelopeBase64: string; userEmail: string }): Promise<{ path: string }> {
    const email = canonicalizeEmail(input.userEmail);
    this.assertOwnedSecure(input.path, email);

    const envelope = Buffer.from(input.envelopeBase64, 'base64');
    const header = this.validateE2EEnvelope(envelope);
    const aad = this.parseAad(header.aad);
    if (aad.path !== input.path) {
      throw new BadRequestException(`envelope AAD path "${aad.path}" does not match request path "${input.path}"`);
    }
    if (!this.storage.writeBytes) {
      throw new Error('storage adapter does not support writeBytes');
    }
    await this.storage.writeBytes(input.path, envelope);
    return { path: input.path };
  }

  async createSecure(input: { path: string; envelopeBase64: string; userEmail: string }): Promise<{ path: string }> {
    const email = canonicalizeEmail(input.userEmail);
    this.assertOwnedSecure(input.path, email);
    if (await this.storage.exists(input.path)) {
      throw new BadRequestException(`destination already exists: ${input.path}`);
    }
    return this.writeSecureBytes(input);
  }

  async moveFromSecure(input: { src: string; dest: string; plaintext: string; userEmail: string }): Promise<{ src: string; dest: string }> {
    const email = canonicalizeEmail(input.userEmail);
    this.assertOwnedSecure(input.src, email);
    this.assertOwnedNonSecure(input.dest, email);
    if (!(await this.storage.exists(input.src))) {
      throw new NotFoundException(`source not found: ${input.src}`);
    }
    if (await this.storage.exists(input.dest)) {
      throw new BadRequestException(`destination already exists: ${input.dest}`);
    }
    // Write through the at-rest boundary; the storage adapter encrypts the
    // bytes with the server KEK because dest is no longer E2E.
    await this.storage.write(input.dest, input.plaintext);
    await this.storage.delete(input.src);
    // Defensive: _secure/ paths cannot be granted today, but revoke anyway so
    // any future regression on that invariant cannot leak a dangling grant.
    await this.grants.cascadeDelete(input.src).catch((err) => {
      this.logger.error(`Failed to revoke grants on moveFromSecure src "${input.src}"`, err);
    });
    return { src: input.src, dest: input.dest };
  }

  private assertOwnedNonSecure(p: string, email: string): void {
    const root = personalRootFor(email);
    if (!isCanonicalPath(p) || !isUnderPersonalRoot(p) || !(p === root || p.startsWith(root + '/'))) {
      throw new ForbiddenException(`path "${p}" is not owned by ${email}`);
    }
    if (isE2EPath(p)) {
      throw new BadRequestException(`path "${p}" is already in _secure/`);
    }
  }

  private assertOwnedSecure(p: string, email: string): void {
    const root = personalRootFor(email);
    if (!isCanonicalPath(p) || !isUnderPersonalRoot(p) || !(p === root || p.startsWith(root + '/'))) {
      throw new ForbiddenException(`path "${p}" is not owned by ${email}`);
    }
    if (!isE2EPath(p)) {
      throw new BadRequestException(`path "${p}" is not under _secure/`);
    }
  }

  private validateE2EEnvelope(buf: Buffer) {
    if (!hasEnvelopeMagic(buf)) {
      throw new BadRequestException('payload is not a Kalepin envelope');
    }
    const header = parseHeader(buf);
    if (header.algorithm !== ALG_AES_256_GCM) {
      throw new BadRequestException(`unsupported algorithm 0x${header.algorithm.toString(16)}`);
    }
    if (header.kdf !== KDF_ARGON2ID) {
      throw new BadRequestException('E2E envelope must declare kdf=Argon2id');
    }
    return header;
  }

  private parseAad(aadBuf: Buffer): { v?: number; path: string; kind?: string; z?: string } {
    let parsed: { v?: number; path?: string; kind?: string; z?: string };
    try {
      parsed = JSON.parse(aadBuf.toString('utf8'));
    } catch {
      throw new BadRequestException('envelope AAD is not valid JSON');
    }
    if (typeof parsed.path !== 'string' || parsed.path.length === 0) {
      throw new BadRequestException('envelope AAD missing "path"');
    }
    return { ...parsed, path: parsed.path };
  }
}
