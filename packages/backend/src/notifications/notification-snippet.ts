import { isE2EPath } from '../crypto/encryption-predicates';

export const SNIPPET_MAX_LENGTH = 160;

/**
 * Short plain-text excerpt stored with an inbox item. `@[name](email)` mention
 * markup collapses to `@name`, whitespace collapses, and the result is capped
 * at 160 chars. Returns null for empty input and for end-to-end encrypted
 * paths, whose plaintext the server must not keep.
 */
export function buildSnippet(text: string | null | undefined, path: string): string | null {
  if (!text || isE2EPath(path)) return null;
  const plain = text
    .replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '@$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  if (plain.length <= SNIPPET_MAX_LENGTH) return plain;
  return plain.slice(0, SNIPPET_MAX_LENGTH - 1).trimEnd() + '…';
}
