import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { GrantsService } from '../grants/grants.service';
import { isCanonicalPath, isVisibleTo, isUnderPersonalRoot, Visibility } from './visibility';

/**
 * Async resolver that layers grants on top of the sync ownership check.
 *
 * - Shared-vault paths and own-personal paths: `{ kind: 'owner' }`.
 * - Foreign-personal paths with an active grant: `{ kind: 'grant', permission }`.
 * - Anything else under `_users/`: `{ kind: 'denied' }` (surfaces as 404).
 */
@Injectable()
export class GrantAwareVisibility {
  constructor(@Optional() private readonly grants?: GrantsService) {}

  async visibilityFor(path: string, viewerEmail: string): Promise<Visibility> {
    if (!isCanonicalPath(path)) return { kind: 'denied' };
    if (isVisibleTo(path, viewerEmail)) return { kind: 'owner' };
    if (this.grants && isUnderPersonalRoot(path)) {
      const grant = await this.grants.findActive(path, viewerEmail);
      if (grant) return { kind: 'grant', permission: grant.permission };
    }
    return { kind: 'denied' };
  }

  async assertReadableBy(path: string, viewerEmail: string): Promise<void> {
    const v = await this.visibilityFor(path, viewerEmail);
    if (v.kind === 'denied') throw new NotFoundException();
  }

  async assertWritableBy(path: string, viewerEmail: string): Promise<void> {
    const v = await this.visibilityFor(path, viewerEmail);
    if (v.kind === 'owner') return;
    if (v.kind === 'grant' && v.permission === 'write') return;
    if (v.kind === 'grant') throw new ForbiddenException('Write permission required');
    throw new NotFoundException();
  }

  async assertCommentableBy(path: string, viewerEmail: string): Promise<void> {
    const v = await this.visibilityFor(path, viewerEmail);
    if (v.kind === 'owner') return;
    if (v.kind === 'grant' && (v.permission === 'comment' || v.permission === 'write')) return;
    if (v.kind === 'grant') throw new ForbiddenException('Comment permission required');
    throw new NotFoundException();
  }

  /** Set of paths the user can see via active grants (for batch filtering). */
  async visibleGrantSet(viewerEmail: string): Promise<Set<string>> {
    if (!this.grants) return new Set();
    const grants = await this.grants.listForGrantee(viewerEmail);
    return new Set(grants.map((g) => g.path));
  }
}
