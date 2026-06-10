import type { Request, Response, NextFunction } from 'express';

// Resolve the CORS allow-list for `/mcp`, `/.well-known/oauth-*`, and `/oauth/*`
// (see design.md Decision 7 and the mcp-cors spec). Always includes
// `https://claude.ai`; operators may add additional origins via the
// comma-separated `OAUTH_CORS_ALLOW_LIST` env var.
export const DEFAULT_OAUTH_CORS_ORIGIN = 'https://claude.ai';

const ALLOWED_HEADERS = 'authorization, content-type, mcp-session-id, mcp-protocol-version';
const ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';
const EXPOSED_HEADERS = 'Mcp-Session-Id, WWW-Authenticate';

export function getOAuthCorsAllowList(env: NodeJS.ProcessEnv = process.env): string[] {
  const extras = (env.OAUTH_CORS_ALLOW_LIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const all = new Set<string>([DEFAULT_OAUTH_CORS_ORIGIN, ...extras]);
  return [...all];
}

export function isOAuthCorsOriginAllowed(origin: string | undefined, allowList: readonly string[]): boolean {
  if (!origin) return false;
  return allowList.includes(origin);
}

// Path predicate: only `/mcp`, `/.well-known/oauth-*`, and `/oauth/*` accept
// cross-origin traffic. Everything else stays first-party.
export function isOAuthCorsPath(path: string): boolean {
  if (path === '/mcp' || path.startsWith('/mcp/') || path.startsWith('/mcp?')) return true;
  if (path.startsWith('/oauth/') || path === '/oauth') return true;
  if (path.startsWith('/.well-known/oauth-')) return true;
  return false;
}

export function createOAuthCorsMiddleware(allowList: readonly string[] = getOAuthCorsAllowList()) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isOAuthCorsPath(req.path)) {
      next();
      return;
    }
    const origin = req.headers['origin'] as string | undefined;
    if (origin && isOAuthCorsOriginAllowed(origin, allowList)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      // Preflight short-circuit. 204 is the conventional response.
      res.status(204).end();
      return;
    }
    next();
  };
}
