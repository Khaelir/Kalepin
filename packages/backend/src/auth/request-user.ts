import { UnauthorizedException } from '@nestjs/common';
import { canonicalizeEmail } from './email';
import type { JwtPayload } from './auth.service';

/**
 * Single chokepoint for stamping `request.user` from any auth path
 * (JWT, API key, OAuth). Re-canonicalizes the email and refuses to attach a
 * payload whose email cannot be normalized — downstream visibility checks
 * (`personalRootFor`, FTS path bindings, RoutingStorageAdapter) treat
 * `req.user.email` as already-canonical, so a non-canonical leak here would
 * cascade into ACL drift.
 */
export function setRequestUser<T extends { user?: JwtPayload }>(target: T, payload: JwtPayload): JwtPayload {
  let email: string;
  try {
    email = canonicalizeEmail(payload.email);
  } catch {
    throw new UnauthorizedException('User email not canonical');
  }
  const stamped: JwtPayload = { ...payload, email };
  target.user = stamped;
  return stamped;
}
