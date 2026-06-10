/**
 * Best-effort client IP for access-log hashing. Mirrors the
 * `req.ip ?? req.socket?.remoteAddress` shape used by `AuthController`.
 *
 * The result is only used as input to a salted HMAC; missing/spoofed values
 * just produce a different (or null) hash and never affect access control.
 */
export function extractClientIp(
  req: { ip?: string; socket?: { remoteAddress?: string } } | undefined,
): string | null {
  if (!req) return null;
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
