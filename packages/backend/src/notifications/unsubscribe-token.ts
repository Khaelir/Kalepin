import * as jwt from 'jsonwebtoken';
import { resolveJwtSecret } from '../auth/jwt-secret';
import { canonicalizeEmail } from '../auth/email';

export const UNSUBSCRIBE_PURPOSE = 'notification-unsubscribe';
const UNSUBSCRIBE_TTL = '365d';

interface UnsubscribePayload {
  sub: string;
  purpose: string;
}

/**
 * Signed, purpose-scoped token for the email unsubscribe link. The recipient
 * travels as `sub` and there is deliberately no `email` claim: the session
 * verifier (`AuthService.verifyToken`) canonicalizes `payload.email`, so this
 * token can never be replayed as a session credential — the same property the
 * PIN unlock tokens rely on.
 */
export function mintUnsubscribeToken(email: string, secret: string = resolveJwtSecret()): string {
  const payload: UnsubscribePayload = { sub: canonicalizeEmail(email), purpose: UNSUBSCRIBE_PURPOSE };
  return jwt.sign(payload as object, secret, { expiresIn: UNSUBSCRIBE_TTL } as jwt.SignOptions);
}

/** Returns the canonical recipient email, or null on any failure (signature,
 * expiry, wrong purpose, malformed subject). */
export function verifyUnsubscribeToken(token: unknown, secret: string = resolveJwtSecret()): string | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object') return null;
  const { sub, purpose } = decoded as Partial<UnsubscribePayload>;
  if (purpose !== UNSUBSCRIBE_PURPOSE || typeof sub !== 'string') return null;
  try {
    return canonicalizeEmail(sub);
  } catch {
    return null;
  }
}
