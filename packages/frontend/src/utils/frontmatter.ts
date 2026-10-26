/**
 * Frontmatter reader for the tag and status pills (top bar + doc header).
 * Mirrors the frontmatter rules of backend/src/tags/tag-parser.ts so the pills
 * show the same tags the server indexes — keep the two in step.
 */

export interface Frontmatter {
  /** Frontmatter tags as written (leading `#` stripped), deduplicated case-insensitively. */
  tags: string[];
  /** Lowercased `status:` value, if any. */
  status: string | null;
}

const TAG_BODY_RE = /^[\p{L}\p{M}\p{N}_\-\/]+$/u;
const HAS_NON_NUMBER_RE = /[^\p{N}\/]/u;
const HAS_ALNUM_RE = /[\p{L}\p{M}\p{N}]/u;
const KEY_RE = /^([A-Za-z_][\w-]*)\s*:(.*)$/;
const BLOCK_ITEM_RE = /^\s*-(?:\s+(.*))?$/;

/** Validate one tag candidate; returns its display form or null. */
export function normalizeTag(raw: string): string | null {
  let s = raw.trim().normalize('NFC');
  if (s.startsWith('#')) s = s.slice(1);
  if (!s || !TAG_BODY_RE.test(s)) return null;
  const display = s.split('/').filter(Boolean).join('/');
  if (!display || !HAS_NON_NUMBER_RE.test(display) || !HAS_ALNUM_RE.test(display)) return null;
  return display;
}

/** Lines between the `---` fences, or null when the note has no (closed) frontmatter. */
function frontmatterLines(content: string): string[] | null {
  const text = content.startsWith('﻿') ? content.slice(1) : content;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trimEnd();
    if (l === '---' || l === '...') return lines.slice(1, i);
  }
  return null;
}

function stripYamlComment(s: string): string {
  return s.replace(/(^|\s)#(\s.*)?$/, '');
}

function unquote(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

export function parseFrontmatter(content: string | null | undefined): Frontmatter {
  const lines = content ? frontmatterLines(content) : null;
  if (!lines) return { tags: [], status: null };

  const items: string[] = [];
  let status: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = KEY_RE.exec(lines[i]);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = stripYamlComment(m[2]).trim();
    if (key === 'status') {
      if (value) status = unquote(value).toLowerCase() || null;
      continue;
    }
    if (key !== 'tags' && key !== 'tag') continue;
    if (value.startsWith('[')) {
      let buf = value;
      while (!buf.includes(']') && i + 1 < lines.length) {
        i++;
        buf += ' ' + stripYamlComment(lines[i]);
      }
      const close = buf.indexOf(']');
      items.push(...buf.slice(1, close === -1 ? undefined : close).split(','));
    } else if (value === '') {
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (next.trim() === '' || /^\s*#(\s|$)/.test(next)) {
          i++;
          continue;
        }
        const item = BLOCK_ITEM_RE.exec(next);
        if (!item) break;
        i++;
        items.push(stripYamlComment(item[1] ?? ''));
      }
    } else if (!/^(\||>|null$|~$)/i.test(value)) {
      items.push(value);
    }
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of items) {
    for (const piece of unquote(item).split(/[,\s]+/)) {
      const tag = normalizeTag(unquote(piece));
      if (!tag || seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return { tags, status };
}

/** The search query that lists the notes carrying `tag` (nested tags included). */
export function tagSearchQuery(tag: string): string {
  return `tag:${tag}`;
}
