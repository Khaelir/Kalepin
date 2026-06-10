// URL routing helpers — extracted from App.tsx so other components (e.g.,
// ShareDialog) can construct canonical doc URLs without importing App.

export const DOC_PREFIX = '/doc/';
export const SHARE_PREFIX = '/s/';
// Legacy short-link prefix. New URLs are minted with SHARE_PREFIX, but the
// parser still recognises `/d/...` so links distributed before the rename
// continue to resolve.
export const SHORT_PREFIX = '/d/';

/** A `/doc/<segment>` is a stable opaque handle when the segment matches this
 * regex — 16 base32 chars, no slash, no dot. Anything else is the legacy
 * `/doc/<file/path>` form (kept resolving for backwards compat; the frontend
 * normalizes to `/doc/<id>` once it has the read response). */
export const DOC_HANDLE_RE = /^[A-Z2-7]{16}$/;

export function buildDocUrlByHandle(
  handleId: string,
  heading?: string,
  threadId?: string,
): string {
  const query = threadId ? `?thread=${encodeURIComponent(threadId)}` : '';
  return (
    DOC_PREFIX +
    handleId +
    query +
    (heading ? `#${encodeURIComponent(heading)}` : '')
  );
}

/** Backwards-compat path-based form. New code should prefer
 * `buildDocUrlByHandle` once the handle is known; this helper is reserved for
 * the moment between "user clicked open" and "server returned the handle". */
export function buildDocUrlByPath(
  filePath: string,
  heading?: string,
  threadId?: string,
): string {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  const query = threadId ? `?thread=${encodeURIComponent(threadId)}` : '';
  return (
    DOC_PREFIX +
    encoded +
    query +
    (heading ? `#${encodeURIComponent(heading)}` : '')
  );
}

export interface UrlParseResult {
  /** Stable opaque doc handle from `/doc/<id>`. */
  handleId?: string;
  /** Share-link code from `/s/<code>` or legacy `/d/<code>`. */
  code?: string;
  /** Legacy fallback: `/doc/<file/path>` for URLs minted before this change. */
  filePath?: string;
}

export function parseDocUrl(): UrlParseResult | null {
  const { pathname } = window.location;

  // `/s/<code>` and legacy `/d/<code>` — code-only. Pre-deploy URLs that
  // included a `/<cosmetic>` suffix still match here: we slice up to the next
  // `/` and ignore the rest, so the code resolves but the cosmetic part is
  // dropped. After resolution the address bar is normalized to `/doc/<id>`.
  for (const prefix of [SHARE_PREFIX, SHORT_PREFIX]) {
    if (pathname.startsWith(prefix)) {
      const rest = pathname.slice(prefix.length);
      if (!rest) return null;
      const slashIdx = rest.indexOf('/');
      const code = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
      return { code };
    }
  }

  if (pathname.startsWith(DOC_PREFIX)) {
    const encoded = pathname.slice(DOC_PREFIX.length);
    if (!encoded) return null;
    // First segment only — `/doc/<id>` has no slash; `/doc/<a/b/c.md>` does.
    const firstSlash = encoded.indexOf('/');
    const firstSegment = firstSlash === -1 ? encoded : encoded.slice(0, firstSlash);
    if (firstSlash === -1 && DOC_HANDLE_RE.test(decodeURIComponent(firstSegment))) {
      return { handleId: decodeURIComponent(firstSegment) };
    }
    return { filePath: decodeURIComponent(encoded) };
  }

  return null;
}

/**
 * URL handed out to recipients. Path-free — recipients only see the opaque
 * code, never the folder structure of the source vault.
 */
export function buildShareLinkUrl(_filePath: string, code: string): string {
  return window.location.origin + SHARE_PREFIX + code;
}
