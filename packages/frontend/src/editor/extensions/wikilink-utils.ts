import type { FileEntry } from '@kalepin/shared';

export interface WikilinkResolution {
  status: 'valid' | 'broken' | 'ambiguous';
  resolvedPath?: string;
  candidates?: string[];
}

/** Flatten a FileEntry tree into a list of .md file paths. */
export function flattenFiles(entries: FileEntry[], prefix = ''): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 'directory' && entry.children) {
      result.push(...flattenFiles(entry.children, fullPath));
    } else if (entry.type === 'file' && entry.name.endsWith('.md')) {
      result.push(fullPath);
    }
  }
  return result;
}

function basename(p: string): string {
  return p.replace(/\.md$/, '').split('/').pop() || p;
}

/**
 * Resolve a wikilink target against the file tree.
 * Port of the backend's resolveWikilink logic.
 */
export function resolveWikilink(
  rawTarget: string,
  activeFile: string,
  allPaths: string[],
): WikilinkResolution {
  // Strip #heading fragment
  const hashIdx = rawTarget.indexOf('#');
  const target = (hashIdx >= 0 ? rawTarget.substring(0, hashIdx) : rawTarget).trim();

  // Empty target = same-page link [[#Heading]]
  if (!target) return { status: 'valid', resolvedPath: activeFile };

  // 1. Exact path match (with .md)
  const withExt = target.endsWith('.md') ? target : target + '.md';
  if (allPaths.includes(withExt)) return { status: 'valid', resolvedPath: withExt };

  // 2. Basename match
  const targetBasename = basename(withExt).toLowerCase();
  const matches = allPaths.filter(
    (p) => basename(p).toLowerCase() === targetBasename,
  );

  if (matches.length === 0) return { status: 'broken' };
  if (matches.length === 1) return { status: 'valid', resolvedPath: matches[0] };

  // 3. Ambiguous: prefer same directory as source
  const sourceDir = activeFile.includes('/') ? activeFile.substring(0, activeFile.lastIndexOf('/')) : '';
  const sameDir = matches.find((p) => {
    const d = p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : '';
    return d === sourceDir;
  });
  if (sameDir) return { status: 'valid', resolvedPath: sameDir };

  return { status: 'ambiguous', candidates: matches };
}

/**
 * Pre-process HTML from tiptap-markdown to replace [[...]] text patterns
 * with <span data-type="wikilink"> elements that the node's parseHTML picks up.
 * Skips code blocks and inline code.
 */
export function preprocessWikilinkHTML(html: string): string {
  // Split on <code>...</code> and <pre>...</pre> to avoid replacing inside them.
  // Odd-indexed parts are code blocks, even-indexed parts are regular content.
  const parts = html.split(/(<code[\s\S]*?<\/code>|<pre[\s\S]*?<\/pre>)/gi);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // code block — skip
    return part.replace(
      /\[\[([^\]]+?)\]\]/g,
      (_, inner: string) => {
        const pipeIdx = inner.indexOf('|');
        const target = pipeIdx >= 0 ? inner.substring(0, pipeIdx).trim() : inner.trim();
        const alias = pipeIdx >= 0 ? inner.substring(pipeIdx + 1).trim() : null;
        const escapedTarget = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const aliasAttr = alias
          ? ` data-alias="${alias.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
          : '';
        return `<span data-type="wikilink" data-target="${escapedTarget}"${aliasAttr}></span>`;
      },
    );
  }).join('');
}

/** Extract display parts from a wikilink target for badge rendering. */
export function parseWikilinkDisplay(target: string, alias: string | null): {
  label: string;
  dirHint: string;
  heading: string | null;
} {
  if (alias) return { label: alias, dirHint: '', heading: null };

  const hashIdx = target.indexOf('#');
  const pathPart = hashIdx >= 0 ? target.substring(0, hashIdx) : target;
  const heading = hashIdx >= 0 ? target.substring(hashIdx + 1) : null;

  const parts = pathPart.split('/');
  const label = parts[parts.length - 1] || (heading ? '' : target);
  const dirHint = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';

  return { label, dirHint, heading };
}
