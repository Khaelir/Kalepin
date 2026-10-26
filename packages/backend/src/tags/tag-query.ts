import { normalizeTagKey } from './tag-parser';

export interface ParsedSearchQuery {
  /** The query with every `tag:` token removed, whitespace collapsed. */
  text: string;
  /** Normalised tag keys (lowercase, no `#`), deduplicated. ANDed by callers. */
  tags: string[];
}

const TAG_TOKEN_RE = /(^|\s)tag:(\S*)/gi;

/**
 * Split a search query into free text and `tag:<name>` filters. Tokens inside
 * double quotes stay text, so `"tag:x"` searches for the phrase. An empty
 * `tag:` is dropped. Shared by REST search and MCP `search_notes` through
 * SearchService.search.
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const quoted: [number, number][] = [];
  for (const m of query.matchAll(/"[^"]*"/g)) quoted.push([m.index!, m.index! + m[0].length]);
  const insideQuotes = (i: number) => quoted.some(([start, end]) => i > start && i < end);

  const tags: string[] = [];
  let text = '';
  let last = 0;
  for (const m of query.matchAll(TAG_TOKEN_RE)) {
    const tokenStart = m.index! + m[1].length;
    if (insideQuotes(tokenStart)) continue;
    const key = normalizeTagKey(m[2]);
    if (key && !tags.includes(key)) tags.push(key);
    text += query.slice(last, tokenStart);
    last = tokenStart + m[0].length - m[1].length;
  }
  text += query.slice(last);
  return { text: text.replace(/\s+/g, ' ').trim(), tags };
}
