import * as path from 'path';
import { PERSONAL_PREFIX } from '../auth/visibility';

export interface ParsedLink {
  rawTarget: string;
  linkType: 'wikilink' | 'markdown';
  lineNumber: number;
  context: string;
  /** Offset in the content where `rawTarget` is written. */
  index: number;
}

/**
 * Extract all inter-note links from markdown content.
 * Supports wikilinks ([[...]]) and markdown links ([text](path.md)).
 * Excludes image embeds (![[...]], ![alt](...)) and external URLs.
 */
export function parseLinksFromMarkdown(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const lines = content.split('\n');
  const leadingSpace = (s: string) => s.length - s.trimStart().length;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Wikilinks: [[target]] or [[target|alias]]
    // Negative lookbehind for ! to exclude embeds ![[...]]
    const wikilinkRegex = /(?<!!)\[\[([^\]]+?)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikilinkRegex.exec(line)) !== null) {
      const inner = match[1];
      // Skip external URLs inside wikilinks
      if (inner.startsWith('http://') || inner.startsWith('https://')) continue;
      // Extract target (before pipe for aliases, strip #heading fragment)
      let rawTarget = inner.split('|')[0].trim();
      const hashIdx = rawTarget.indexOf('#');
      if (hashIdx >= 0) rawTarget = rawTarget.substring(0, hashIdx).trim();
      // Empty rawTarget means same-page link like [[#Heading]] — stored with empty target,
      // resolved to source file at query time
      if (!rawTarget && hashIdx < 0) continue;
      const index = lineStart + match.index + 2 + leadingSpace(inner);
      links.push({ rawTarget, linkType: 'wikilink', lineNumber, context: line, index });
    }

    // Markdown links: [text](path) — exclude images ![alt](path)
    // Negative lookbehind for ! to exclude image embeds
    const mdLinkRegex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = mdLinkRegex.exec(line)) !== null) {
      const target = match[2].trim();
      // Skip external URLs
      if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:')) continue;
      // Skip non-markdown files (images, etc.)
      if (!target.endsWith('.md')) continue;
      const index = lineStart + match.index + match[1].length + 3 + leadingSpace(match[2]);
      links.push({ rawTarget: target, linkType: 'markdown', lineNumber, context: line, index });
    }
    lineStart += line.length + 1;
  }

  return links;
}

/** Replace `length` characters at `index` with `text`. */
export interface TextEdit {
  index: number;
  length: number;
  text: string;
}

/**
 * Edits that change link targets in `content`, for exactly the links
 * `parseLinksFromMarkdown` finds. `retarget` returns a link's new target, or
 * null to leave it. Only the target is replaced: a wikilink's `#heading` and
 * `|alias`, and a markdown link's text, stay as written. Same-page links
 * ([[#Heading]]) are never passed. The edits are sorted and do not overlap.
 */
export function linkTargetEdits(
  content: string,
  retarget: (link: ParsedLink) => string | null,
): TextEdit[] {
  const edits: TextEdit[] = [];
  let end = 0;
  const links = parseLinksFromMarkdown(content).sort((a, b) => a.index - b.index);
  for (const link of links) {
    if (!link.rawTarget || link.index < end) continue;
    const text = retarget(link);
    if (text === null || text === link.rawTarget) continue;
    edits.push({ index: link.index, length: link.rawTarget.length, text });
    end = link.index + link.rawTarget.length;
  }
  return edits;
}

/** `content` with sorted, non-overlapping `edits` applied. */
export function applyTextEdits(content: string, edits: TextEdit[]): string {
  let out = '';
  let pos = 0;
  for (const edit of edits) {
    out += content.slice(pos, edit.index) + edit.text;
    pos = edit.index + edit.length;
  }
  return out + content.slice(pos);
}

/** `_users/{email}` for a path in a personal folder, `''` for the shared vault. */
export function linkNamespace(notePath: string): string {
  if (!notePath.startsWith(PERSONAL_PREFIX)) return '';
  const slash = notePath.indexOf('/', PERSONAL_PREFIX.length);
  return slash < 0 ? notePath : notePath.slice(0, slash);
}

/**
 * Whether a link written in `sourcePath` may resolve to `targetPath`. A shared
 * note links to shared notes only; a personal note links to its owner's
 * notes and to shared notes. Never to another user's personal notes, even
 * one shared through a grant: a link there would expose that note's name to
 * every reader of the linking note, and renaming it would rewrite their note.
 */
export function canLinkTo(sourcePath: string, targetPath: string): boolean {
  const ns = linkNamespace(targetPath);
  return ns === '' || ns === linkNamespace(sourcePath);
}

/**
 * Resolve a wikilink target to an actual file path using shortest-unique-path matching.
 * Only notes the source may link to are candidates (see `canLinkTo`).
 * Resolution order:
 * 1. Exact path match (with or without .md extension)
 * 2. Unique basename match, the source's own personal notes before shared notes
 * 3. Same-directory preference for ambiguous basenames
 */
export function resolveWikilink(
  rawTarget: string,
  sourcePath: string,
  allPaths: string[],
): string | null {
  // Strip any #heading fragment before resolution
  const hashIdx = rawTarget.indexOf('#');
  const target = (hashIdx >= 0 ? rawTarget.substring(0, hashIdx) : rawTarget).trim();

  // Empty target = same-page link [[#Heading]], resolves to source file
  if (!target) return sourcePath;

  const candidates = allPaths.filter((p) => canLinkTo(sourcePath, p));

  // 1. Exact path match (with .md)
  const withExt = target.endsWith('.md') ? target : target + '.md';
  if (candidates.includes(withExt)) return withExt;

  // Also try without .md if target already has it
  if (target.endsWith('.md') && candidates.includes(target)) return target;

  // 2. Basename match — in a personal note, its owner's notes win over shared ones
  const targetBasename = path.basename(withExt, '.md').toLowerCase();
  const allMatches = candidates.filter(
    (p) => path.basename(p, '.md').toLowerCase() === targetBasename,
  );
  const home = linkNamespace(sourcePath);
  const ownMatches = home ? allMatches.filter((p) => linkNamespace(p) === home) : [];
  const matches = ownMatches.length > 0 ? ownMatches : allMatches;

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // 3. Ambiguous: prefer same directory as source
  const sourceDir = path.dirname(sourcePath);
  const sameDir = matches.find((p) => path.dirname(p) === sourceDir);
  if (sameDir) return sameDir;

  // Fallback: return first match
  return matches[0];
}

/**
 * Resolve a markdown link target (relative path) to an absolute vault path.
 */
export function resolveMarkdownLink(
  rawTarget: string,
  sourcePath: string,
): string {
  const sourceDir = path.dirname(sourcePath);
  return path.posix.normalize(path.posix.join(sourceDir, rawTarget));
}

/**
 * The target a wikilink written `rawTarget`, which resolved to `oldPath`,
 * should read once that note is at `newPath`. The link keeps its form: a
 * name stays a name, the full path stays a full path, a path ending the old
 * path keeps its number of segments, any other path keeps its folder part,
 * and a `.md` suffix stays as written. When that would resolve from
 * `sourcePath` to another note among `paths`, or depend on their order to
 * pick between same-named notes, the full new path is used.
 */
export function renamedWikilinkTarget(
  rawTarget: string,
  oldPath: string,
  newPath: string,
  sourcePath: string,
  paths: string[],
): string {
  const ext = rawTarget.endsWith('.md') ? '.md' : '';
  const written = rawTarget.slice(0, rawTarget.length - ext.length).split('/');
  const oldSegments = oldPath.slice(0, -'.md'.length).split('/');
  const newSegments = newPath.slice(0, -'.md'.length).split('/');
  const tail = oldSegments.slice(-written.length);
  const endsOldPath = written.length <= oldSegments.length
    && written.every((s, i) => s.toLowerCase() === tail[i].toLowerCase());

  let next: string;
  if (endsOldPath && written.length === oldSegments.length) next = newSegments.join('/');
  else if (endsOldPath) next = newSegments.slice(-written.length).join('/');
  else next = [...written.slice(0, -1), newSegments[newSegments.length - 1]].join('/');
  next += ext;

  const resolvesToNewPath = (candidates: string[]) => resolveWikilink(next, sourcePath, candidates) === newPath;
  if (resolvesToNewPath(paths) && resolvesToNewPath([...paths].reverse())) return next;
  return newSegments.join('/') + ext;
}

/** A markdown link target from `sourcePath` to `targetPath`, keeping a leading `./` if written. */
export function relativeMarkdownTarget(rawTarget: string, sourcePath: string, targetPath: string): string {
  const relative = path.posix.relative(path.posix.dirname(sourcePath), targetPath);
  return rawTarget.startsWith('./') && !relative.startsWith('../') ? './' + relative : relative;
}
