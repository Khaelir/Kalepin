import type { RelatedNoteReason } from '../api';
import { prettifyPath } from '../crypto/path-predicates';
import { resolveWikilink } from '../editor/extensions/wikilink-utils';

/**
 * Embeddings for a note with an open editor session are re-computed 45 s after
 * the last edit (backend EMBEDDING_INACTIVITY_MS), so refetching sooner would
 * only return the pre-edit ranking.
 */
export const RELATED_REFRESH_DELAY_MS = 50_000;

const OPEN_STORAGE_KEY = 'kalepin.related.open';

/** Parent folder for display ('' at the vault root); personal roots are prettified. */
export function relatedFolderLabel(path: string): string {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return '';
  return prettifyPath(path.slice(0, slash));
}

/** "§ Deployment — Build the image…", or just the excerpt when the chunk has no heading. */
export function relatedReasonLabel(reason: RelatedNoteReason | null): string {
  if (!reason) return '';
  const excerpt = reason.excerpt.trim();
  if (!reason.heading) return excerpt;
  return excerpt ? `§ ${reason.heading} — ${excerpt}` : `§ ${reason.heading}`;
}

/**
 * Wikilink target that resolves to `targetPath` from `activeFile`: the bare
 * note name when that is unambiguous, otherwise the full path without `.md`.
 */
export function wikilinkTargetFor(targetPath: string, activeFile: string, allPaths: string[]): string {
  const name = (targetPath.split('/').pop() || targetPath).replace(/\.md$/, '');
  const resolved = resolveWikilink(name, activeFile, allPaths);
  return resolved.resolvedPath === targetPath ? name : targetPath.replace(/\.md$/, '');
}

export function readRelatedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeRelatedOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Private mode / blocked storage: the section just reopens next time.
  }
}
