import { isE2EEncrypted } from '../crypto/path-predicates';

const PERSONAL_PREFIX = '_users/';
const DAY_MS = 86_400_000;

/** `path` is `base` itself or lives under it. */
export function isSelfOrUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(base + '/');
}

/** Display name of a note or folder: basename, without `.md`. */
export function displayName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

/**
 * Human label for where a trashed item used to live: "Vault" for the vault
 * root, "Personal" / "Personal / Drafts" for the user's own folder, the
 * folder path otherwise.
 */
export function trashLocationLabel(originalFolder: string): string {
  if (!originalFolder) return 'Vault';
  if (!originalFolder.startsWith(PERSONAL_PREFIX)) return originalFolder;
  const rest = originalFolder.slice(PERSONAL_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return 'Personal';
  return `Personal / ${rest.slice(slash + 1)}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function formatDeletedAgo(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(diff / DAY_MS);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** Whole days left before automatic purge, or null when retention is off. */
export function daysUntilPurge(deletedAt: number, retentionDays: number, now: number = Date.now()): number | null {
  if (retentionDays <= 0) return null;
  const left = deletedAt + retentionDays * DAY_MS - now;
  return Math.max(0, Math.ceil(left / DAY_MS));
}

/** Confirmation copy for the file-tree delete. `_secure/` items skip the trash. */
export function deleteConfirmCopy(entry: { path: string; type: 'file' | 'directory' }): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  const name = displayName(entry.path);
  if (isE2EEncrypted(entry.path)) {
    return {
      title: 'Delete permanently?',
      message: `“${name}” is in your Encrypted Folder, which has no trash. It will be deleted for good.`,
      confirmLabel: 'Delete permanently',
    };
  }
  const what = entry.type === 'directory' ? 'This folder and everything in it' : 'This note';
  return {
    title: 'Move to trash?',
    message: `${what} will move to the trash. You can restore “${name}” from Trash at the bottom of the sidebar.`,
    confirmLabel: 'Move to trash',
  };
}

/**
 * Where a doc that lived at `docPath` ends up when the trashed item
 * `originalPath` is restored at `restoredPath` (they differ when the original
 * name was taken and the item came back as "Name (restored)").
 */
export function pathAfterRestore(docPath: string, originalPath: string, restoredPath: string): string {
  if (!isSelfOrUnder(docPath, originalPath)) return docPath;
  return restoredPath + docPath.slice(originalPath.length);
}
