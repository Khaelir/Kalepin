/**
 * Heading-delimited sections of a markdown note, for the MCP tools that read
 * or append to one section instead of the whole note.
 *
 * Only ATX headings (`## Title`) count. Lines inside fenced code blocks and a
 * leading YAML frontmatter block are skipped, so `# comment` lines there are
 * not mistaken for headings.
 */

export interface Section {
  level: number;
  /** Heading text without the `#` markers. */
  title: string;
  /** Line index of the heading. */
  start: number;
  /** Line index after the section, sub-sections included (next heading of the same or a higher level, or EOF). */
  end: number;
  /** Line index after the section's own text, before its first sub-heading. */
  ownEnd: number;
}

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.replace(/\r$/, '') !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line === '---' || line === '...') return i + 1;
  }
  return 0;
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function parseSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const headings: { level: number; title: string; line: number }[] = [];
  let fence: string | null = null;
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = line.match(HEADING_RE);
    if (!m) continue;
    const title = (m[2] ?? '').replace(/[ \t]+#+$/, '').replace(/^#+$/, '').trim();
    headings.push({ level: m[1].length, title, line: i });
  }
  return headings.map((h, idx) => {
    const next = headings.slice(idx + 1).find((n) => n.level <= h.level);
    return {
      level: h.level,
      title: h.title,
      start: h.line,
      end: next ? next.line : lines.length,
      ownEnd: idx + 1 < headings.length ? headings[idx + 1].line : lines.length,
    };
  });
}

/**
 * Sections whose heading matches `query`: "Decisions" matches that title at
 * any level, "## Decisions" only at level 2. Case and spacing are ignored.
 */
export function findSections(markdown: string, query: string): Section[] {
  const q = query.trim().match(/^(#{1,6})[ \t]+(.*)$/);
  const level = q ? q[1].length : undefined;
  const title = normalizeTitle(q ? q[2] : query);
  return parseSections(markdown).filter(
    (s) => normalizeTitle(s.title) === title && (level === undefined || s.level === level),
  );
}

/** The headings of a note as `## Title` lines, to show when a section is not found. */
export function headingOutline(markdown: string): string {
  const sections = parseSections(markdown);
  if (sections.length === 0) return '(this note has no headings)';
  return sections.map((s) => `${'#'.repeat(s.level)} ${s.title}`).join('\n');
}

/** Text of each matching section (heading included, trailing blank lines dropped). */
export function readSections(markdown: string, query: string): string[] {
  const lines = markdown.split('\n');
  return findSections(markdown, query).map((s) => {
    let end = s.end;
    while (end > s.start + 1 && lines[end - 1].trim() === '') end--;
    return lines.slice(s.start, end).join('\n');
  });
}

export class SectionNotFoundError extends Error {}

/**
 * Insert `content` at the end of a section's own text, before any sub-heading.
 * Without a `separator`, a list item added after a list item gets a single
 * newline (so the list stays tight) and anything else a blank line.
 * Throws when no section or more than one matches.
 */
export function insertIntoSection(markdown: string, query: string, content: string, separator?: string): string {
  const matches = findSections(markdown, query);
  if (matches.length === 0) {
    throw new SectionNotFoundError(`No section "${query}" in this note. Its headings:\n${headingOutline(markdown)}`);
  }
  if (matches.length > 1) {
    const where = matches.map((s) => `"${'#'.repeat(s.level)} ${s.title}" (line ${s.start + 1})`).join(', ');
    throw new Error(`${matches.length} sections match "${query}": ${where}. Give the heading level (e.g. "## ${matches[0].title}") or use patch_note.`);
  }
  const section = matches[0];
  const lines = markdown.split('\n');
  let last = section.ownEnd - 1;
  while (last > section.start && lines[last].trim() === '') last--;

  const body = content.replace(/\n+$/, '');
  const sep = separator ?? (
    last > section.start && LIST_ITEM_RE.test(lines[last]) && LIST_ITEM_RE.test(body) ? '\n' : '\n\n'
  );
  const before = lines.slice(0, last + 1).join('\n');
  if (section.ownEnd < lines.length) {
    return `${before}${sep}${body}\n\n${lines.slice(section.ownEnd).join('\n')}`;
  }
  return `${before}${sep}${body}${markdown.endsWith('\n') ? '\n' : ''}`;
}
