import * as path from 'path';
import { PERSONAL_PREFIX, TRASH_DIR, isUnderPersonalRoot } from '../auth/visibility';
import type { TrashZone } from '../entities/trash-item.entity';

/** Zone of a live (non-trash) virtual path. */
export function zoneOf(virtualPath: string): TrashZone {
  return isUnderPersonalRoot(virtualPath) ? 'personal' : 'shared';
}

/** Canonical owner email of a personal path, or null for the shared vault. */
export function ownerOf(virtualPath: string): string | null {
  if (!isUnderPersonalRoot(virtualPath)) return null;
  const tail = virtualPath.slice(PERSONAL_PREFIX.length);
  const slash = tail.indexOf('/');
  return (slash < 0 ? tail : tail.slice(0, slash)).toLowerCase();
}

/** Trash root for the zone `virtualPath` lives in. */
export function trashRootFor(virtualPath: string): string {
  const owner = ownerOf(virtualPath);
  return owner ? `${PERSONAL_PREFIX}${owner}/${TRASH_DIR}` : TRASH_DIR;
}

/** `<trash root>/<id>/<basename>` for an item deleted from `originalPath`. */
export function trashPathFor(originalPath: string, itemId: string): string {
  return `${trashRootFor(originalPath)}/${itemId}/${path.posix.basename(originalPath)}`;
}

/** `p` is `base` itself or lives under it. */
export function isSelfOrUnder(p: string, base: string): boolean {
  return p === base || p.startsWith(base + '/');
}

/**
 * Restore name for attempt `n` (1-based): `Plan (restored).md`,
 * `Plan (restored 2).md`, … Folders have no extension: `Drafts (restored)`.
 */
export function restoredName(originalPath: string, kind: 'file' | 'folder', n: number): string {
  const dir = path.posix.dirname(originalPath);
  const base = path.posix.basename(originalPath);
  const ext = kind === 'file' ? path.posix.extname(base) : '';
  const stem = ext ? base.slice(0, -ext.length) : base;
  const suffix = n <= 1 ? ' (restored)' : ` (restored ${n})`;
  const leaf = `${stem}${suffix}${ext}`;
  return dir === '.' ? leaf : `${dir}/${leaf}`;
}
