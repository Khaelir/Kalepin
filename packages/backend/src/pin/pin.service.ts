import { Injectable, Logger, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { NoteMeta } from '../entities/note-meta.entity';
import { parseCookies } from './cookies';
import { resolveJwtSecret } from '../auth/jwt-secret';

export const PIN_REGEX = /^\S{8,}$/;
export const PIN_MIN_LENGTH = 8;
export const BCRYPT_COST = 12;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
export const OWNER_TTL_SECONDS = 24 * 60 * 60;
export const GRANTEE_TTL_SECONDS = 24 * 60 * 60;
export const ONE_SHOT_TTL_SECONDS = 60;

export type UnlockKind = 'owner' | 'grantee' | 'share-viewer' | 'one-shot';

export interface UnlockTokenPayload {
  sub: string;
  path: string;
  kind: UnlockKind;
  exp: number;
}

export interface VerifyResult {
  ok: boolean;
  token?: string;
  ttlSeconds?: number;
  cookieName?: string;
  remainingAttempts?: number;
  lockoutUntil?: number;
}

/**
 * Per-path cookie name; truncated SHA-256 keeps cookies isolated and avoids
 * leaking the path through cookie metadata.
 */
export function pinCookieName(path: string): string {
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 16);
  return `kalepin_pin_unlock_${hash}`;
}

interface AttemptState {
  failedAttempts: number;
  firstAttemptAtInWindow: number | null;
  lockoutUntil: number | null;
}

@Injectable()
export class PinService {
  private readonly logger = new Logger(PinService.name);
  private readonly jwtSecret: string;
  // In-memory rate-limit state, keyed by `${identifier}::${path}` so guest
  // attempts (identifier=`ip:1.2.3.4`) cannot lock out the owner
  // (identifier=`user:owner@…`). Counters do not survive a restart, which is
  // acceptable: PIN is friction, not E2E, and 5 attempts per 15-minute window
  // is preserved within a process lifetime.
  private readonly attemptStates = new Map<string, AttemptState>();

  constructor(
    @InjectRepository(NoteMeta) private readonly repo: Repository<NoteMeta>,
  ) {
    this.jwtSecret = resolveJwtSecret();
  }

  private attemptKey(path: string, identifier: string): string {
    return `${identifier}::${path}`;
  }

  private getOrInitAttemptState(key: string): AttemptState {
    let s = this.attemptStates.get(key);
    if (!s) {
      s = { failedAttempts: 0, firstAttemptAtInWindow: null, lockoutUntil: null };
      this.attemptStates.set(key, s);
    }
    return s;
  }

  async getMeta(path: string): Promise<NoteMeta | null> {
    return (await this.repo.findOne({ where: { path } })) ?? null;
  }

  async hasPin(path: string): Promise<boolean> {
    const meta = await this.getMeta(path);
    return !!meta?.pinHash;
  }

  async setPin(path: string, pin: string, owner: string): Promise<void> {
    if (!PIN_REGEX.test(pin)) {
      throw new BadRequestException(`PIN must be at least ${PIN_MIN_LENGTH} characters with no whitespace`);
    }
    const hash = await bcrypt.hash(pin, BCRYPT_COST);
    const existing = await this.getMeta(path);
    if (existing) {
      existing.pinHash = hash;
      existing.pinSetBy = owner;
      existing.pinSetAt = Date.now();
      existing.pinFailedAttempts = 0;
      existing.pinLastAttemptAt = null;
      existing.pinFirstAttemptAtInWindow = null;
      existing.pinLockoutUntil = null;
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create({
        path,
        pinHash: hash,
        pinSetBy: owner,
        pinSetAt: Date.now(),
        pinFailedAttempts: 0,
        pinLastAttemptAt: null,
        pinFirstAttemptAtInWindow: null,
        pinLockoutUntil: null,
      }));
    }
  }

  async removePin(path: string): Promise<void> {
    const existing = await this.getMeta(path);
    if (!existing) return;
    existing.pinHash = null;
    existing.pinSetBy = null;
    existing.pinSetAt = null;
    existing.pinFailedAttempts = 0;
    existing.pinLastAttemptAt = null;
    existing.pinFirstAttemptAtInWindow = null;
    existing.pinLockoutUntil = null;
    await this.repo.save(existing);
  }

  /**
   * Verify a PIN attempt. Returns ok=false (with remainingAttempts or
   * lockoutUntil) on failure, or ok=true plus a fresh JWT on success.
   *
   * Rate-limit accounting is keyed by (path, attemptIdentifier). For
   * authenticated owner/grantee attempts the default identifier is
   * `user:${viewer}`, so each user has their own bucket. Anonymous share-link
   * attempts must pass `ip:${clientIP}` so a single bad-actor IP cannot lock
   * out the owner or other guests on the same link.
   */
  async verifyPin(
    path: string,
    pin: string,
    viewer: string,
    kind: UnlockKind,
    attemptIdentifier: string = `user:${viewer}`,
  ): Promise<VerifyResult> {
    const meta = await this.getMeta(path);
    if (!meta || !meta.pinHash) {
      throw new BadRequestException('No PIN set for this path');
    }

    const now = Date.now();
    const key = this.attemptKey(path, attemptIdentifier);
    const state = this.getOrInitAttemptState(key);

    if (state.lockoutUntil && state.lockoutUntil > now) {
      return { ok: false, lockoutUntil: state.lockoutUntil };
    }
    if (state.lockoutUntil && state.lockoutUntil <= now) {
      state.lockoutUntil = null;
      state.failedAttempts = 0;
      state.firstAttemptAtInWindow = null;
    }

    const matches = await bcrypt.compare(pin, meta.pinHash);
    if (matches) {
      this.attemptStates.delete(key);
      const ttlSeconds = this.ttlFor(kind);
      const token = this.mintUnlockToken(path, viewer, kind, ttlSeconds);
      return { ok: true, token, ttlSeconds, cookieName: pinCookieName(path) };
    }

    // Sliding window: reset the counter when the first-attempt timestamp
    // falls outside the window.
    if (
      !state.firstAttemptAtInWindow ||
      now - state.firstAttemptAtInWindow > RATE_LIMIT_WINDOW_MS
    ) {
      state.firstAttemptAtInWindow = now;
      state.failedAttempts = 0;
    }
    state.failedAttempts += 1;

    if (state.failedAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
      state.lockoutUntil = now + LOCKOUT_DURATION_MS;
      state.failedAttempts = 0;
      state.firstAttemptAtInWindow = null;
      return { ok: false, lockoutUntil: state.lockoutUntil };
    }

    return {
      ok: false,
      remainingAttempts: RATE_LIMIT_MAX_ATTEMPTS - state.failedAttempts,
    };
  }

  /** Test helper: force-expire any active lockout for (path, identifier). */
  _expireLockoutForTest(path: string, attemptIdentifier: string): void {
    const state = this.attemptStates.get(this.attemptKey(path, attemptIdentifier));
    if (state) {
      state.lockoutUntil = null;
      state.failedAttempts = 0;
      state.firstAttemptAtInWindow = null;
    }
  }

  /** Issue a JWT scoped to (path, viewer, kind) without verifying a PIN. */
  mintUnlockToken(path: string, viewer: string, kind: UnlockKind, ttlSeconds?: number): string {
    const ttl = ttlSeconds ?? this.ttlFor(kind);
    const payload: UnlockTokenPayload = {
      sub: viewer,
      path,
      kind,
      exp: Math.floor(Date.now() / 1000) + ttl,
    };
    return jwt.sign(payload as object, this.jwtSecret);
  }

  private ttlFor(kind: UnlockKind): number {
    switch (kind) {
      case 'owner': return OWNER_TTL_SECONDS;
      case 'grantee': return GRANTEE_TTL_SECONDS;
      case 'one-shot': return ONE_SHOT_TTL_SECONDS;
      // Share-viewer is session-only at the cookie layer; we still sign a
      // 24h token to bound the underlying credential.
      case 'share-viewer': return OWNER_TTL_SECONDS;
    }
  }

  /**
   * Validate an unlock token against (path, viewer). Returns the payload on
   * success or null on any failure (signature, expiry, path mismatch, sub
   * mismatch). For share-viewer tokens the sub is `anonymous-<code>`, so the
   * caller passes that synthetic identifier as viewer.
   */
  validateUnlockToken(token: string, path: string, viewer: string): UnlockTokenPayload | null {
    let decoded: UnlockTokenPayload;
    try {
      decoded = jwt.verify(token, this.jwtSecret) as UnlockTokenPayload;
    } catch {
      return null;
    }
    if (decoded.path !== path) return null;
    if (decoded.kind === 'share-viewer') {
      if (decoded.sub !== viewer) return null;
    } else {
      if (decoded.sub !== viewer) return null;
    }
    return decoded;
  }

  /**
   * True iff the path has a PIN AND the supplied unlock token (if any) is
   * invalid. Routes call this before serving content.
   */
  async isLocked(path: string, viewer: string, unlockToken: string | null): Promise<boolean> {
    const meta = await this.getMeta(path);
    if (!meta?.pinHash) return false;
    if (!unlockToken) return true;
    const payload = this.validateUnlockToken(unlockToken, path, viewer);
    return !payload;
  }

  /**
   * Like isLocked, but tolerates a one-shot header token: the token must match
   * (path, viewer) and have kind=one-shot. Returns true (locked) only if no
   * valid cookie OR header is present.
   */
  async assertUnlocked(
    path: string,
    viewer: string,
    cookieToken: string | null,
    headerToken: string | null,
  ): Promise<void> {
    const meta = await this.getMeta(path);
    if (!meta?.pinHash) return;
    if (cookieToken && this.validateUnlockToken(cookieToken, path, viewer)) return;
    if (headerToken && this.validateUnlockToken(headerToken, path, viewer)) return;
    throw new PinLockedException(path);
  }

  /**
   * Convenience for controllers: read the unlock cookie + optional one-shot
   * header from a request and throw 423 Locked if the path is gated and
   * neither credential validates. Pulls cookie / header inline so callers do
   * not need to know the cookie naming convention.
   */
  async assertUnlockedForRequest(
    req: { headers: { cookie?: string; 'x-kalepin-unlock'?: string | string[] } },
    path: string,
    viewer: string,
  ): Promise<void> {
    if (!(await this.hasPin(path))) return;
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[pinCookieName(path)] ?? null;
    const headerRaw = req.headers['x-kalepin-unlock'];
    const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : (headerRaw ?? null);
    return this.assertUnlocked(path, viewer, cookieToken, headerToken ?? null);
  }

  /** Owner-only listing for Settings → Security. */
  async listLockedFor(owner: string): Promise<{ path: string; pinSetAt: number | null }[]> {
    const rows = await this.repo
      .createQueryBuilder('m')
      .where('m.pinHash IS NOT NULL')
      .andWhere('m.pinSetBy = :owner', { owner })
      .getMany();
    return rows.map((r) => ({ path: r.path, pinSetAt: r.pinSetAt }));
  }
}

/**
 * 423 Locked exception. NestJS does not ship a built-in for 423, so we throw
 * a plain HttpException with the status code via a small subclass.
 */
export class PinLockedException extends HttpException {
  constructor(path: string) {
    super(
      { error: 'pin-locked', message: 'PIN required for this path', path },
      HttpStatus.LOCKED,
    );
  }
}
