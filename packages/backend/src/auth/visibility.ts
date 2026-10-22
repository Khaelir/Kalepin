import { NotFoundException } from '@nestjs/common';

export const PERSONAL_PREFIX = '_users/';

export function personalRootFor(email: string): string {
  return PERSONAL_PREFIX + email;
}

export function isUnderPersonalRoot(virtualPath: string): boolean {
  return virtualPath.startsWith(PERSONAL_PREFIX);
}

/**
 * True when `virtualPath` is spelled the one way storage will resolve it:
 * no `.`/`..` or empty segments, no leading or trailing slash, no backslash,
 * no NUL. `''` (the vault root) is canonical. Prefix-based ownership checks
 * are only sound on canonical paths — `_users/alice/../bob/x.md` starts with
 * alice's root but resolves into bob's folder.
 */
export function isCanonicalPath(virtualPath: string): boolean {
  if (virtualPath === '') return true;
  if (virtualPath.includes('\\') || virtualPath.includes('\0')) return false;
  return virtualPath.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/**
 * Synchronous "owner-or-shared-vault" check. Returns true when the path is
 * shared (non-personal) or when it falls under the viewer's own personal root.
 * Foreign personal paths return false here regardless of grants — the
 * grant-aware variant lives in `GrantAwareVisibility`. Non-canonical paths
 * are never visible.
 */
export function isVisibleTo(virtualPath: string, viewerEmail: string): boolean {
  if (!isCanonicalPath(virtualPath)) return false;
  if (!isUnderPersonalRoot(virtualPath)) return true;
  const root = personalRootFor(viewerEmail);
  return virtualPath === root || virtualPath.startsWith(root + '/');
}

/** Sync owner-only assertion. Prefer `GrantAwareVisibility.assertReadableBy`
 *  for any code path that should also honor grants. */
export function assertReadableBy(virtualPath: string, viewerEmail: string): void {
  if (!isVisibleTo(virtualPath, viewerEmail)) throw new NotFoundException();
}

export function assertWritableBy(virtualPath: string, viewerEmail: string): void {
  if (!isVisibleTo(virtualPath, viewerEmail)) throw new NotFoundException();
}

export function isPersonalRootSegment(virtualPath: string): boolean {
  if (!isUnderPersonalRoot(virtualPath)) return false;
  const tail = virtualPath.slice(PERSONAL_PREFIX.length);
  return tail.length > 0 && !tail.includes('/');
}

/**
 * Discriminated union describing why a path is visible (or not) to a viewer.
 * Public-share kind is reserved for code paths that resolve a `?code=` query
 * parameter; the file/comment HTTP routes do not pass a share code.
 */
export type Visibility =
  | { kind: 'owner' }
  | { kind: 'grant'; permission: 'read' | 'comment' | 'write' }
  | { kind: 'public_share'; code: string }
  | { kind: 'denied' };

/** Owner or denied — sync, no grants consulted. The grant-aware variant lives
 *  in `GrantAwareVisibility.visibilityFor`. */
export function visibilityForSync(path: string, viewerEmail: string): Visibility {
  return isVisibleTo(path, viewerEmail) ? { kind: 'owner' } : { kind: 'denied' };
}
