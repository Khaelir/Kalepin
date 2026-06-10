import type { Request, Response, NextFunction } from 'express';

/**
 * Baseline HTTP security headers applied to every response. Covers the
 * cheap, universally-safe wins:
 *   - `X-Content-Type-Options: nosniff` — defeats MIME-sniffing-based
 *     content-type confusion (uploaded HTML disguised as image, polyglot
 *     payloads, etc.).
 *   - `X-Frame-Options: DENY` — defense-in-depth clickjacking guard.
 *     The drawio iframe is served from `/drawio/embed.html` and overrides
 *     this header in its own per-route middleware.
 *   - `Referrer-Policy: same-origin` — drops the path/query when navigating
 *     externally (e.g. clicking an outbound link from a note).
 *   - `Permissions-Policy: ...` — opts out of high-risk features the app
 *     does not need (geolocation, camera, mic, payment, USB, etc.).
 *   - `Strict-Transport-Security` — only when the request arrived over
 *     HTTPS (respects `trust proxy` + `X-Forwarded-Proto`).
 *   - `Content-Security-Policy` — a permissive-but-not-dangerous default
 *     for the React SPA: scripts and styles from same-origin only, no
 *     framing, no plugins. Vite emits hashed assets so 'unsafe-inline'
 *     for scripts is not required. Inline styles are still allowed because
 *     several upstream UI libraries inject them; tighten with hashes/nonces
 *     in a future pass.
 *
 * Routes that need a custom CSP (`/drawio/embed.html`, anywhere a future
 * iframe is served) MUST run their own header-setting middleware AFTER
 * this one — `res.setHeader` replaces.
 */
export function createSecurityHeadersMiddleware() {
  // Google Fonts is whitelisted because index.html loads Source Serif 4,
  // JetBrains Mono, and Material Symbols Rounded from there. The stylesheet
  // arrives from fonts.googleapis.com; the woff2 binaries from fonts.gstatic.com.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  const permissionsPolicy = [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
    'interest-cohort=()',
  ].join(', ');

  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', permissionsPolicy);
    res.setHeader('Content-Security-Policy', csp);

    // Only emit HSTS over a verified-secure connection (req.protocol respects
    // X-Forwarded-Proto when `trust proxy` is set). Sending it over HTTP is a
    // no-op for compliant clients but a footgun if a stray http endpoint is
    // ever served behind the same APP_URL.
    if (req.protocol === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
