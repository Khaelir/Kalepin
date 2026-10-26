import { TRASH_DIR } from '../auth/visibility';

/**
 * Directory-walk filter shared by the zone encrypt/decrypt sweep and the
 * `rotate-kek` CLI. Dot entries are skipped (`.deleted/`, `.obsidian/`,
 * sidecars, `_attachments/.trash/`) except the zone trash folders — `.trash/`
 * at the shared vault root and `{email}/.trash/` under the personal root.
 * Trashed notes are restorable, so they must follow the zone's encryption
 * state and KEK.
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
  if (!isDirectory || name !== TRASH_DIR) return true;
  if (zone === 'shared') return parentRel !== '';
  return parentRel === '' || parentRel.includes('/');
}
