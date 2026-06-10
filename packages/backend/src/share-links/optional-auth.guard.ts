import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CombinedAuthGuard } from '../auth';

/**
 * Best-effort auth: if a Bearer credential is present, validate it through
 * `CombinedAuthGuard`; otherwise let the request through with `req.user`
 * left undefined. Used by `share-links/resolve` and `share-links/:code/...`
 * endpoints that have to serve both authenticated and anonymous viewers.
 *
 * Downstream code MUST treat `req.user` as optional and never assume the
 * caller is identified just because the request reached the handler.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly combined: CombinedAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header) return true; // anonymous: pass through, req.user stays undefined
    try {
      return await this.combined.canActivate(context);
    } catch {
      // A malformed or expired credential is effectively anonymous for these
      // routes — drop it silently rather than 401-ing the whole request.
      return true;
    }
  }
}
