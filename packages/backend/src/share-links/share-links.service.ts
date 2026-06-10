import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { ShortLink } from '../entities/short-link.entity';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import { resolveJwtSecret } from '../auth/jwt-secret';
import { DocHandlesService } from '../doc-handles/doc-handles.service';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Body length in chars (random portion). 11 base62 chars ≈ 65 bits. */
const CODE_BODY_LEN = 11;
/** HMAC suffix length in chars. 4 base62 ≈ 24 bits — used for typo detection,
 * not as a security boundary. A random typo has ~1/14.7M chance of accidentally
 * hitting a valid checksum, so a typo'd code is rejected before it ever
 * reaches the database. */
const CODE_TAG_LEN = 4;
/** Total user-visible code length. */
const CODE_LEN = CODE_BODY_LEN + CODE_TAG_LEN; // 15

/**
 * Render a non-negative BigInt as exactly `len` base62 characters
 * (least-significant-digit first, matching the original encoder shape).
 */
function bigIntToBase62(value: bigint, len: number): string {
  const chars: string[] = [];
  let num = value;
  for (let i = 0; i < len; i++) {
    chars.push(BASE62[Number(num % 62n)]);
    num = num / 62n;
  }
  return chars.join('');
}

/**
 * Compute the 4-char base62 typo-check tag for a body. Uses HMAC-SHA256 with
 * the same secret that signs scoped tokens, truncated to its first 4 bytes
 * (32 bits) and encoded as 4 base62 chars. The tag is non-secret — its only
 * purpose is to reject obvious typos before a DB hit.
 */
function computeCodeTag(body: string): string {
  const mac = createHmac('sha256', resolveJwtSecret()).update(body).digest();
  const value = BigInt('0x' + mac.subarray(0, 4).toString('hex'));
  return bigIntToBase62(value, CODE_TAG_LEN);
}

function generateCode(): string {
  // 11 base62 chars need ⌈log₂(62¹¹)⌉ = 66 bits. 9 random bytes (72 bits)
  // covers it with negligible modulo bias.
  const bytes = randomBytes(9);
  const num = BigInt('0x' + bytes.toString('hex'));
  const body = bigIntToBase62(num, CODE_BODY_LEN);
  return body + computeCodeTag(body);
}

/**
 * Reject codes whose tag doesn't match HMAC(body) — a typo'd code is dropped
 * here without ever touching the DB. Legacy 10-char codes (minted before the
 * tag was introduced) are passed through; they have no tag to verify.
 */
export function verifyCodeIntegrity(code: string): boolean {
  if (code.length !== CODE_LEN) return true; // legacy or other lengths
  const body = code.slice(0, CODE_BODY_LEN);
  const tag = code.slice(CODE_BODY_LEN);
  const expected = computeCodeTag(body);
  if (tag.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(tag), Buffer.from(expected));
}

export type ResolveResult =
  | { kind: 'ok'; path: string }
  | { kind: 'gone'; reason: 'revoked' | 'expired' }
  | { kind: 'not_found' };

export interface ShareLinkInfo {
  code: string;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
  last_resolved_at: number | null;
  created_by_email: string | null;
  allow_guest_comments: boolean;
}

@Injectable()
export class ShareLinksService {
  private readonly logger = new Logger(ShareLinksService.name);

  constructor(
    @InjectRepository(ShortLink) private readonly repo: Repository<ShortLink>,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates,
    private readonly docHandles?: DocHandlesService,
  ) {}

  /** Mint a new share-link in response to an explicit user action.
   *
   * Idempotent: if an active (non-revoked, non-expired) row already exists
   * for the path, returns its code unchanged. If the existing row is
   * expired or revoked, mints a *new* code and leaves the old row in place
   * — the old code stays 410, the new one resolves. */
  async mintExplicit(input: {
    path: string;
    ttlMs?: number | null;
    createdByEmail: string | null;
    allowGuestComments?: boolean;
  }): Promise<{ code: string }> {
    const { path, ttlMs, createdByEmail, allowGuestComments } = input;

    // Stage-2 seam: an E2E note's plaintext lives only on the user's device,
    // so a server-minted share link cannot resolve to readable content.
    if (!this.predicates.shareLinkMintable(path)) {
      throw new BadRequestException(
        `share link cannot be minted for end-to-end encrypted path "${path}"`,
      );
    }

    if (!(await this.storage.exists(path))) {
      throw new Error(`File not found: ${path}`);
    }

    const now = Date.now();
    const active = await this.findActiveByPath(path, now);
    if (active) return { code: active.code };

    const code = generateCode();
    const expiresAt = ttlMs == null ? null : now + ttlMs;
    await this.repo.save({
      code,
      path,
      expiresAt,
      createdByEmail,
      revokedAt: null,
      allowGuestComments: allowGuestComments ?? false,
    });
    return { code };
  }

  /** Toggle the allow_guest_comments flag on an existing row. No-ops if the
   * row does not exist. Authorization is the caller's responsibility. */
  async setAllowGuestComments(code: string, value: boolean): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ allowGuestComments: value })
      .where('code = :code', { code })
      .execute();
  }

  /** Whether guest commenting is currently allowed for a code. Returns false
   * when the row is missing, revoked, or expired. */
  async guestCommentingAllowed(code: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { code } });
    if (!row) return false;
    if (row.revokedAt !== null) return false;
    if (row.expiresAt !== null && Date.now() > row.expiresAt) return false;
    return !!row.allowGuestComments;
  }

  /** Legacy auto-mint path. Kept for internal callers (mention-notification
   * email links) where the historical "never expires, no created-by" semantics
   * are intentional. New flows MUST go through `mintExplicit`. */
  async getOrCreate(path: string): Promise<string> {
    const { code } = await this.mintExplicit({
      path,
      ttlMs: null,
      createdByEmail: null,
    });
    return code;
  }

  /** Mark a code as revoked. Subsequent resolves return `{ kind: 'gone' }`.
   * No-op when the code does not exist or is already revoked. */
  async revoke(code: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: Date.now() })
      .where('code = :code', { code })
      .andWhere('revokedAt IS NULL')
      .execute();
  }

  /** Look up the most relevant share-link row for a path (active first, then
   * the most recent revoked/expired row). Returns null when no row exists. */
  async findByPath(path: string): Promise<ShareLinkInfo | null> {
    const now = Date.now();
    const active = await this.findActiveByPath(path, now);
    const row =
      active ??
      (await this.repo
        .createQueryBuilder('s')
        .where('s.path = :path', { path })
        .orderBy('s.createdAt', 'DESC')
        .getOne());
    if (!row) return null;
    return {
      code: row.code,
      expires_at: row.expiresAt,
      revoked_at: row.revokedAt,
      created_at: row.createdAt.getTime(),
      last_resolved_at: null,
      created_by_email: row.createdByEmail,
      allow_guest_comments: !!row.allowGuestComments,
    };
  }

  /** Resolve a code into its current state. Distinguishes "no such code"
   * (404) from "code existed but is gone" (410). */
  async resolve(code: string): Promise<ResolveResult> {
    // Reject typo'd codes before hitting the DB. Same response shape as
    // "not_found" so the public surface gives no hint whether a code that
    // failed the check might exist with a different tag — a crawler can't
    // distinguish "wrong tag" from "wrong body".
    if (!verifyCodeIntegrity(code)) return { kind: 'not_found' };
    const link = await this.repo.findOne({ where: { code } });
    if (!link) return { kind: 'not_found' };
    if (link.revokedAt !== null) return { kind: 'gone', reason: 'revoked' };
    if (link.expiresAt !== null && Date.now() > link.expiresAt) {
      return { kind: 'gone', reason: 'expired' };
    }
    return { kind: 'ok', path: link.path };
  }

  async updatePath(oldPath: string, newPath: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ path: newPath })
      .where('path = :oldPath', { oldPath })
      .execute();
  }

  async updatePathPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    const items = await this.repo
      .createQueryBuilder('s')
      .where('s.path LIKE :prefix', { prefix: `${oldPrefix}/%` })
      .getMany();

    for (const item of items) {
      item.path = newPrefix + item.path.slice(oldPrefix.length);
      await this.repo.save(item);
    }
  }

  async deleteByPath(path: string): Promise<void> {
    await this.repo.delete({ path });
  }

  /** Look up a code's path even when revoked/expired. Used by the revoke
   * endpoint so it can authorize against the underlying path *after* the
   * caller has lost the active state. Returns null when no row exists. */
  async pathForCodeIncludingGone(code: string): Promise<string | null> {
    const row = await this.repo.findOne({ where: { code } });
    return row?.path ?? null;
  }

  /** Look up a code's full row metadata regardless of revoked/expired
   * status. Used by the revoke / patch endpoints (which need creator email
   * to gate authorization) and by resolve (which needs the guest-comment
   * flag for its response). */
  async infoForCodeIncludingGone(
    code: string,
  ): Promise<{
    path: string;
    createdByEmail: string | null;
    allow_guest_comments: boolean;
    handleId: string | null;
  } | null> {
    const row = await this.repo.findOne({ where: { code } });
    if (!row) return null;
    // forPath is no-mint here — gone codes shouldn't auto-mint a handle for a
    // path the file may also be tombstoned for. The resolve endpoint mints
    // explicitly when the link is active.
    const handleId = this.docHandles
      ? await this.docHandles.forPath(row.path)
      : null;
    return {
      path: row.path,
      createdByEmail: row.createdByEmail,
      allow_guest_comments: !!row.allowGuestComments,
      handleId,
    };
  }

  private async findActiveByPath(
    path: string,
    now: number,
  ): Promise<ShortLink | null> {
    const row = await this.repo
      .createQueryBuilder('s')
      .where('s.path = :path', { path })
      .andWhere('s.revokedAt IS NULL')
      .andWhere('(s.expiresAt IS NULL OR s.expiresAt > :now)', { now })
      .orderBy('s.createdAt', 'DESC')
      .getOne();
    return row ?? null;
  }
}
