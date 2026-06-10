import { createHash, randomBytes } from 'crypto';

// Opaque DB-backed tokens (see design.md Decision 1). Prefixes let
// CombinedAuthGuard route to the OAuth verification path without trying every
// table. Raw form is `<prefix><43 base64url chars>`; only the SHA-256 hash is
// persisted, matching the existing `kp_` API-key pattern.
export const ACCESS_TOKEN_PREFIX = 'kpoa_at_';
export const REFRESH_TOKEN_PREFIX = 'kpoa_rt_';

const RANDOM_BYTES = 32; // 32 bytes → 43 base64url chars (no padding)

export interface MintedToken {
  raw: string;
  hash: string;
}

function base64UrlNoPad(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function mintAccessToken(): MintedToken {
  const raw = ACCESS_TOKEN_PREFIX + base64UrlNoPad(randomBytes(RANDOM_BYTES));
  return { raw, hash: hashToken(raw) };
}

export function mintRefreshToken(): MintedToken {
  const raw = REFRESH_TOKEN_PREFIX + base64UrlNoPad(randomBytes(RANDOM_BYTES));
  return { raw, hash: hashToken(raw) };
}

export function isAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX);
}

export function isRefreshToken(token: string): boolean {
  return token.startsWith(REFRESH_TOKEN_PREFIX);
}
