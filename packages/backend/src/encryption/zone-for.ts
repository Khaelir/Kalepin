import { PERSONAL_PREFIX } from '../auth/visibility';
import type { EncryptionZoneName } from '../entities/encryption-zone.entity';

/**
 * Map a virtual path to the encryption zone that owns it.
 *
 * Personal zone: the bare `_users` segment, or any path with the `_users/` prefix.
 * Shared zone: everything else (including `vault/_users/...` which is a literal
 * subdirectory of the shared vault — there's a startup guard against the physical
 * `_users` reservation, but a path that *contains* `_users` further down is shared).
 */
export function zoneFor(virtualPath: string): EncryptionZoneName {
  if (virtualPath === '_users') return 'personal';
  if (virtualPath.startsWith(PERSONAL_PREFIX)) return 'personal';
  return 'shared';
}
