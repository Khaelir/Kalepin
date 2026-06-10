// Frontend mirror of backend `isE2EEncrypted(path)`. Same shape as the spec
// in design.md: a path is E2E iff it lives directly under a personal-root
// `_secure` segment (`_users/{email}/_secure[/...]`).

export function isE2EEncrypted(path: string): boolean {
  if (!path.startsWith('_users/')) return false;
  const rest = path.slice('_users/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return false;
  const tail = rest.slice(slash + 1);
  return tail === '_secure' || tail.startsWith('_secure/');
}

/** Human-facing label for the `_secure/` folder. The on-disk name stays `_secure`. */
export const ENCRYPTED_FOLDER_LABEL = 'Encrypted Folder';

/**
 * Convert a stored path into a label suitable for the UI:
 *   `_users/alice@x/_secure/My note.md` → `/alice@x/Encrypted Folder/My note.md`
 *   `_users/alice@x/Notes/foo.md`       → `/alice@x/Notes/foo.md`
 *   `_users/alice@x/_secure`            → `/alice@x/Encrypted Folder`
 * Anything outside the `_users/` namespace is returned unchanged.
 */
export function prettifyPath(path: string): string {
  if (!path.startsWith('_users/')) return path;
  const rest = path.slice('_users/'.length);
  const prettyRest = rest
    .replace(/\/_secure$/, `/${ENCRYPTED_FOLDER_LABEL}`)
    .replace(/\/_secure\//g, `/${ENCRYPTED_FOLDER_LABEL}/`);
  return `/${prettyRest}`;
}
