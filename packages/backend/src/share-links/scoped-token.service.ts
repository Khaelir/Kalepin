import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { resolveJwtSecret } from '../auth/jwt-secret';

/**
 * Default lifetime of a share-link access token. Capped to the share-link's
 * own expiry whenever shorter — see `mintAccessToken` callers.
 */
export const ACCESS_TOKEN_DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Per-asset tokens are short-lived; an embedded image's URL only needs to
 * survive one render of the doc. */
export const ASSET_TOKEN_DEFAULT_TTL_MS = 30 * 60 * 1000;

interface AccessPayload {
  k: 'a';
  c: string;
  p: string;
  e: number;
}

interface AssetPayload {
  k: 'x';
  c: string;
  p: string;
  e: number;
}

/**
 * Scoped HMAC tokens for anonymous share-link viewers.
 *
 * The trust model: possession of a valid token proves the holder previously
 * resolved a specific share-code to a specific path; the server then trusts
 * them to *read* that one resource without ever associating them with a user
 * identity. Any request that mixes a token with a different (code, path)
 * fails verification.
 *
 * Two token kinds:
 *  - **access** (`kind='a'`): authorizes `GET /api/share-links/:code/content`
 *    for the shared note itself.
 *  - **asset** (`kind='x'`): authorizes `GET /api/share-links/:code/asset`
 *    for one specific embedded resource (image / attachment) referenced by
 *    the shared note. Issued by the server when it rewrites the markdown.
 *
 * Tokens are NOT JWTs: they carry only the minimal `(kind, code, path, exp)`
 * tuple, so a leaked token never doubles as a session credential.
 */
@Injectable()
export class ScopedTokenService {
  private readonly secret: string;

  constructor() {
    this.secret = resolveJwtSecret();
  }

  mintAccessToken(input: {
    code: string;
    path: string;
    ttlMs?: number;
  }): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + (input.ttlMs ?? ACCESS_TOKEN_DEFAULT_TTL_MS);
    const payload: AccessPayload = {
      k: 'a',
      c: input.code,
      p: input.path,
      e: expiresAt,
    };
    return { token: this.encode(payload), expiresAt };
  }

  mintAssetToken(input: {
    code: string;
    assetPath: string;
    ttlMs?: number;
  }): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + (input.ttlMs ?? ASSET_TOKEN_DEFAULT_TTL_MS);
    const payload: AssetPayload = {
      k: 'x',
      c: input.code,
      p: input.assetPath,
      e: expiresAt,
    };
    return { token: this.encode(payload), expiresAt };
  }

  /** Verify an access token. Returns the decoded `(code, path)` tuple on
   * success; null on any failure (signature, expiry, kind mismatch). */
  verifyAccessToken(token: string): { code: string; path: string } | null {
    const decoded = this.decode<AccessPayload>(token);
    if (!decoded || decoded.k !== 'a') return null;
    if (decoded.e < Date.now()) return null;
    return { code: decoded.c, path: decoded.p };
  }

  /** Verify a per-asset token. Same shape as access verification but with
   * a different kind so an access token can never be replayed as an asset
   * token (or vice versa). */
  verifyAssetToken(token: string): { code: string; assetPath: string } | null {
    const decoded = this.decode<AssetPayload>(token);
    if (!decoded || decoded.k !== 'x') return null;
    if (decoded.e < Date.now()) return null;
    return { code: decoded.c, assetPath: decoded.p };
  }

  private encode(payload: AccessPayload | AssetPayload): string {
    const body = base64urlEncode(JSON.stringify(payload));
    const sig = this.sign(body);
    return `${body}.${sig}`;
  }

  private decode<T>(token: string): T | null {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.sign(body);
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      return JSON.parse(base64urlDecode(body)) as T;
    } catch {
      return null;
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret)
      .update(body)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}

function base64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(s: string): string {
  // Pad back to a multiple of 4 for Buffer.from('base64').
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standard, 'base64').toString('utf8');
}
