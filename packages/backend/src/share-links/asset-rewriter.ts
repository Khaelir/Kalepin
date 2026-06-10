/**
 * Rewrite attachment references in shared markdown so guest viewers (who hold
 * a scoped access token but no session) can fetch images and other inline
 * assets without ever calling the authenticated `/api/files/attachment` route.
 *
 * Each rewritten URL points at `/api/share-links/<code>/asset?name=<name>&st=<token>`
 * with a per-asset HMAC. `mintAssetToken` is supplied by the caller so this
 * module stays free of DI concerns and is trivially unit-testable.
 *
 * Recognised reference shapes:
 *  - Markdown image: `![alt](_attachments/abcd.png)`
 *  - Markdown image with relative climb: `![](../_attachments/abcd.png)`
 *  - Markdown link: `[label](_attachments/abcd.png)` (downloadable attachment)
 *  - HTML img src: `<img src="_attachments/abcd.png">` (uncommon but possible)
 *
 * Anything that doesn't end in `_attachments/<bareName>` is left untouched —
 * external URLs, raw Markdown text, drawio embeds that don't use the
 * `_attachments` convention. The rewriter is conservative on purpose: any
 * miss results in a broken image in guest view, never in a leaked path.
 */

const ATTACHMENT_REF_RE = /(_attachments\/)([A-Za-z0-9._-]+)/g;

export interface AssetTokenMinter {
  mintAssetToken(input: {
    code: string;
    assetPath: string;
  }): { token: string; expiresAt: number };
}

export function rewriteMarkdownForGuest(
  markdown: string,
  code: string,
  minter: AssetTokenMinter,
): string {
  // Only rewrite refs that appear inside (...) of an MD link/image, or
  // src="..." / src='...' of an HTML img. We lift those candidates out, then
  // rewrite each candidate's attachment reference.
  return markdown
    .replace(
      /(!?\[[^\]]*\]\()([^()\s][^)]*)(\))/g,
      (full, prefix: string, url: string, suffix: string) => {
        const rewritten = rewriteOneUrl(url, code, minter);
        if (rewritten === url) return full;
        return `${prefix}${rewritten}${suffix}`;
      },
    )
    .replace(
      /(<img\b[^>]*\bsrc=)("([^"]*)"|'([^']*)')/gi,
      (_full, prefix: string, _quoted: string, dq: string | undefined, sq: string | undefined) => {
        const url = dq ?? sq ?? '';
        const quoteChar = dq !== undefined ? '"' : "'";
        const rewritten = rewriteOneUrl(url, code, minter);
        return `${prefix}${quoteChar}${rewritten}${quoteChar}`;
      },
    );
}

function rewriteOneUrl(url: string, code: string, minter: AssetTokenMinter): string {
  // Reset and re-test rather than reusing the global regex's state.
  ATTACHMENT_REF_RE.lastIndex = 0;
  const match = ATTACHMENT_REF_RE.exec(url);
  if (!match) return url;
  const name = match[2];
  // Refuse traversal-looking names. The capture regex stops at slashes, but
  // `..` (two dots) is a valid character-class match — return an empty URL
  // so the browser renders a broken-image icon and never dispatches a
  // request relative to the guest page.
  if (name.includes('/') || name === '..' || name.startsWith('..')) return '';
  const { token } = minter.mintAssetToken({ code, assetPath: name });
  return `/api/share-links/${encodeURIComponent(code)}/asset?name=${encodeURIComponent(name)}&st=${encodeURIComponent(token)}`;
}
