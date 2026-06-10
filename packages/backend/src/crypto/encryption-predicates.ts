import { Injectable } from '@nestjs/common';
import { EncryptionZonesService } from '../encryption/encryption-zones.service';
import { zoneFor } from '../encryption/zone-for';

export interface EncryptionPredicates {
  /** Is this file an envelope on disk? */
  isEncryptedAtRest(path: string): boolean;
  /** Is the keyholder a client (stage 2)? Always false in stage 1. */
  isE2EEncrypted(path: string): boolean;
  /** Can FTS / embeddings / link-index see plaintext? */
  shouldIndexPlaintext(path: string): boolean;
  /** Can the OT gateway open this doc for collaboration? */
  canCollab(path: string): boolean;
  /** Should comment bodies be opaque to the server? */
  commentBodiesEncrypted(path: string): boolean;
  /** Can `/api/share-links` mint a link for this doc? */
  shareLinkMintable(path: string): boolean;
}

/**
 * Stage-1 implementation. The four "stage-2 follower" predicates already consult
 * `isE2EEncrypted` so that flipping that single method in stage 2 cascades to
 * the rest without touching call sites.
 */
@Injectable()
export class DefaultEncryptionPredicates implements EncryptionPredicates {
  constructor(private readonly zones: EncryptionZonesService) {}

  isEncryptedAtRest(path: string): boolean {
    if (this.isE2EEncrypted(path)) return true;
    return this.zones.isEnabled(zoneFor(path));
  }

  isE2EEncrypted(path: string): boolean {
    return isE2EPath(path);
  }

  shouldIndexPlaintext(path: string): boolean {
    return !this.isE2EEncrypted(path);
  }

  canCollab(path: string): boolean {
    return !this.isE2EEncrypted(path);
  }

  commentBodiesEncrypted(path: string): boolean {
    return this.isE2EEncrypted(path);
  }

  shareLinkMintable(path: string): boolean {
    return !this.isE2EEncrypted(path);
  }
}

export const ENCRYPTION_PREDICATES = 'ENCRYPTION_PREDICATES';

/**
 * `path` is end-to-end encrypted iff it is the bare `_secure` folder or any
 * descendant directly under a personal user root: `_users/{email}/_secure[/...]`.
 *
 * Examples:
 *   `_users/alice/_secure`               → true   (the folder itself)
 *   `_users/alice/_secure/foo.md`        → true
 *   `_users/alice/_secure/sub/bar.md`    → true
 *   `_users/alice/notes/foo.md`          → false
 *   `_users/alice/foo/_secure/bar.md`    → false  (not directly under user root)
 *   `vault/_secure/foo.md`               → false  (not under personal namespace)
 *   `_secure/foo.md`                     → false
 */
export function isE2EPath(path: string): boolean {
  if (!path.startsWith('_users/')) return false;
  const rest = path.slice('_users/'.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx < 0) return false;
  const tail = rest.slice(slashIdx + 1);
  return tail === '_secure' || tail.startsWith('_secure/');
}
