import * as path from 'path';

export interface ParsedLink {
  rawTarget: string;
  linkType: 'wikilink' | 'markdown';
  lineNumber: number;
  context: string;
}

/**
 * Extract all inter-note links from markdown content.
 * Supports wikilinks ([[...]]) and markdown links ([text](path.md)).
 * Excludes image embeds (![[...]], ![alt](...)) and external URLs.
 */
export function parseLinksFromMarkdown(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const lines = content.split('\n');

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
      links.push({ rawTarget, linkType: 'wikilink', lineNumber, context: line });
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
      links.push({ rawTarget: target, linkType: 'markdown', lineNumber, context: line });
    }
  }

  return links;
}

/**
 * Resolve a wikilink target to an actual file path using shortest-unique-path matching.
 * Resolution order:
 * 1. Exact path match (with or without .md extension)
 * 2. Unique basename match
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

  // 1. Exact path match (with .md)
  const withExt = target.endsWith('.md') ? target : target + '.md';
  if (allPaths.includes(withExt)) return withExt;

  // Also try without .md if target already has it
  if (target.endsWith('.md') && allPaths.includes(target)) return target;

  // 2. Basename match
  const targetBasename = path.basename(withExt, '.md').toLowerCase();
  const matches = allPaths.filter(
    (p) => path.basename(p, '.md').toLowerCase() === targetBasename,
  );

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
