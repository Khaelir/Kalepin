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
