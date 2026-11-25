import { TRASH_DIR } from '../auth/visibility';

/** A comment sidecar next to a note: `.<name>.collab` (see SidecarService). */
const COMMENT_SIDECAR = /^\..+\.collab$/;

/**
 * Directory-walk filter shared by the zone encrypt/decrypt sweep and the
 * `rotate-kek` CLI. Dot entries are skipped (`.deleted/`, `.obsidian/`,
 * `_attachments/.trash/`) except comment sidecars and the zone trash folders —
 * `.trash/` at the shared vault root and `{email}/.trash/` under the personal
 * root. Sidecars (`.<note>.collab`) are written through the encrypting
 * adapter, and trashed notes are restorable, so both must follow the zone's
 * encryption state and KEK.
 *
 * `parentRel` is the physical path of the directory being listed, relative to
 * the zone root ('' for the root itself).
 */
export function skipSweepEntry(
  name: string,
  isDirectory: boolean,
  parentRel: string,
  zone: 'shared' | 'personal',
): boolean {
  if (!name.startsWith('.')) return false;
  if (!isDirectory) return !COMMENT_SIDECAR.test(name);
  if (name !== TRASH_DIR) return true;
  if (zone === 'shared') return parentRel !== '';
  return parentRel === '' || parentRel.includes('/');
}
