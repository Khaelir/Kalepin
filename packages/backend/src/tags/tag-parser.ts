/**
 * Obsidian-compatible tag extraction. Tags come from the YAML frontmatter
 * (`tags:` / `tag:`) and from inline `#tag`s in the body. Matching is
 * case-insensitive: `tag` is the lowercase key, `display` keeps the casing as
 * written. See openspec/changes/add-tag-index/design.md "Parsing rules".
 *
 * The frontmatter half is mirrored in frontend/src/utils/frontmatter.ts — keep
 * the two in step.
 */

export interface ParsedTag {
  /** Lowercase key used for matching. */
  tag: string;
  /** The tag as written, minus the leading `#`. */
  display: string;
}

const TAG_BODY_RE = /^[\p{L}\p{M}\p{N}_\-\/]+$/u;
const HAS_NON_NUMBER_RE = /[^\p{N}\/]/u;
const HAS_ALNUM_RE = /[\p{L}\p{M}\p{N}]/u;

/**
 * Validate and normalise one tag candidate. A leading `#` is stripped, empty
 * `/` segments are dropped. Returns null when the candidate is not a tag:
 * characters outside letters / numbers / `_` / `-` / `/`, numbers only
 * (`#1984`), or punctuation only (`#-`).
 */
export function normalizeTag(raw: string): ParsedTag | null {
  let s = raw.trim().normalize('NFC');
  if (s.startsWith('#')) s = s.slice(1);
  if (!s || !TAG_BODY_RE.test(s)) return null;
  const display = s.split('/').filter(Boolean).join('/');
  if (!display) return null;
  if (!HAS_NON_NUMBER_RE.test(display) || !HAS_ALNUM_RE.test(display)) return null;
  return { tag: display.toLowerCase(), display };
}

/**
 * Normalise a tag typed by a user (search `tag:` token, `?tag=` parameter)
 * into its lookup key without rejecting it: an invalid value simply matches
 * nothing. Returns '' when nothing is left.
 */
export function normalizeTagKey(raw: string): string {
  let s = raw.trim().normalize('NFC');
  if (s.startsWith('#')) s = s.slice(1);
  return s.split('/').filter(Boolean).join('/').toLowerCase();
}

export interface FrontmatterSplit {
  /** Lines between the opening and closing fences, or null when there is no frontmatter. */
  frontmatter: string[] | null;
  /** Everything after the closing fence (the whole content without frontmatter). */
  body: string;
}

/**
 * Frontmatter starts on the very first line with `---` and ends at the next
 * `---` or `...` line. Without a closing line the whole file is body.
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
  const text = content.startsWith('﻿') ? content.slice(1) : content;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') return { frontmatter: null, body: text };
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trimEnd();
    if (l === '---' || l === '...') {
      return { frontmatter: lines.slice(1, i), body: lines.slice(i + 1).join('\n') };
    }
  }
  return { frontmatter: null, body: text };
}

/** Drop a YAML comment: `#` preceded by start/whitespace and followed by whitespace/end. */
function stripYamlComment(s: string): string {
  return s.replace(/(^|\s)#(\s.*)?$/, '');
}

function unquote(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

const FRONTMATTER_KEY_RE = /^(tags?)\s*:(.*)$/i;
const BLOCK_ITEM_RE = /^\s*-(?:\s+(.*))?$/;

/** Raw tag values from the frontmatter `tags` / `tag` keys (not yet validated). */
function frontmatterTagValues(lines: string[]): string[] {
  const items: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const key = FRONTMATTER_KEY_RE.exec(lines[i]);
    if (!key) continue;
    const value = stripYamlComment(key[2]).trim();
    if (value.startsWith('[')) {
      // Flow list, possibly spread over several lines.
      let buf = value;
      while (!buf.includes(']') && i + 1 < lines.length) {
        i++;
        buf += ' ' + stripYamlComment(lines[i]);
      }
      const close = buf.indexOf(']');
      items.push(...buf.slice(1, close === -1 ? undefined : close).split(','));
    } else if (value === '') {
      // Block list: `- a` lines, optionally indented. Blank and comment
      // lines are skipped; any other line ends the list.
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
  return items;
}

/** Tags declared in frontmatter lines, deduplicated, in order. */
export function parseFrontmatterTags(frontmatter: string[]): ParsedTag[] {
  const out: ParsedTag[] = [];
  for (const item of frontmatterTagValues(frontmatter)) {
    for (const piece of unquote(item).split(/[,\s]+/)) {
      const t = normalizeTag(unquote(piece));
      if (t) out.push(t);
    }
  }
  return dedupe(out);
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const REFERENCE_DEF_RE = /^ {0,3}\[[^\]]+\]:\s/;
const INLINE_TAG_RE = /(?<![\p{L}\p{M}\p{N}_#&\/\\])#([\p{L}\p{M}\p{N}_\-\/]+)/gu;

const MASKS: RegExp[] = [
  /<!--.*?-->/g, // HTML comment
  /!?\[\[[^\]]*\]\]/g, // wikilink / embed — `[[#Heading]]` is a link, not a tag
  /\]\([^)]*\)/g, // markdown link destination `](#anchor)`
  /<\/?[a-zA-Z][^>]*>/g, // HTML tag `<a href="#x">`
  /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S*/g, // URL with a scheme
  /\bwww\.\S+/g,
];

function blank(s: string): string {
  return ' '.repeat(s.length);
}

/** Replace inline code spans (backtick runs of matching length) with spaces. */
function maskInlineCode(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++];
      continue;
    }
    let j = i;
    while (j < line.length && line[j] === '`') j++;
    const run = j - i;
    let close = -1;
    let k = j;
    while (k < line.length) {
      if (line[k] !== '`') {
        k++;
        continue;
      }
      let m = k;
      while (m < line.length && line[m] === '`') m++;
      if (m - k === run) {
        close = k;
        break;
      }
      k = m;
    }
    if (close === -1) {
      // Unmatched run: literal backticks.
      out += line.slice(i, j);
      i = j;
      continue;
    }
    out += blank(line.slice(i, close + run));
    i = close + run;
  }
  return out;
}

/** Inline `#tags` in a markdown body (frontmatter already removed). */
export function parseInlineTags(body: string): ParsedTag[] {
  const out: ParsedTag[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      // Closing fence: same character, at least as long, nothing after it.
      const c = FENCE_CLOSE_RE.exec(line);
      if (c && c[1][0] === fence.char && c[1].length >= fence.len) fence = null;
      continue;
    }
    const f = FENCE_RE.exec(line);
    if (f) {
      fence = { char: f[1][0], len: f[1].length };
      continue;
    }
    if (REFERENCE_DEF_RE.test(line)) continue;
    let masked = maskInlineCode(line);
    for (const re of MASKS) masked = masked.replace(re, blank);
    for (const m of masked.matchAll(INLINE_TAG_RE)) {
      const t = normalizeTag(m[1]);
      if (t) out.push(t);
    }
  }
  return dedupe(out);
}

/** All tags of a note: frontmatter first, then inline; one entry per key. */
export function parseTags(content: string): ParsedTag[] {
  const { frontmatter, body } = splitFrontmatter(content);
  return dedupe([
    ...(frontmatter ? parseFrontmatterTags(frontmatter) : []),
    ...parseInlineTags(body),
  ]);
}

function dedupe(tags: ParsedTag[]): ParsedTag[] {
  const seen = new Set<string>();
  return tags.filter((t) => (seen.has(t.tag) ? false : (seen.add(t.tag), true)));
}
