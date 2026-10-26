const PLACEHOLDER_ORIGIN = 'http://kalepin.invalid';

/**
 * Reduce a client-supplied post-login `returnTo` to a path on this origin.
 * The session token is appended to the redirect, so the target must never
 * leave the app: `startsWith('/')` alone lets `//evil.example/` and
 * `/\evil.example/` through, which browsers treat as protocol-relative.
 * Anything that does not survive the round trip falls back to `/`.
 */
export function safeReturnPath(returnTo: unknown): string {
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(returnTo)) return '/';
  let url: URL;
  try {
    url = new URL(returnTo, PLACEHOLDER_ORIGIN);
  } catch {
    return '/';
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return '/';
  const path = url.pathname + url.search + url.hash;
  // Dot segments can collapse into a leading `//` (`/.//evil.example/`).
  return path.startsWith('//') ? '/' : path;
}

/**
 * The post-login redirect shared by every login method: the sanitised
 * `returnTo` with `params` (the session `token`, or an `sso_error`) set in
 * its query. The params go before the fragment, so hash routes such as
 * `/#/oauth/consent?request_id=…` keep both the route and the token, which
 * the SPA reads from `location.search`. A param already present in
 * `returnTo` is replaced, never duplicated.
 */
export function buildPostLoginRedirect(returnTo: unknown, params: Record<string, string>): string {
  const path = safeReturnPath(returnTo);
  const hashAt = path.indexOf('#');
  const beforeHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : path.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const pathname = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = new URLSearchParams(queryAt === -1 ? '' : beforeHash.slice(queryAt + 1));
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  return `${pathname}?${query.toString()}${fragment}`;
}
