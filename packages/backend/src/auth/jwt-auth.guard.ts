import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { setRequestUser } from './request-user';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const token = authHeader.slice(7);
    const payload = this.authService.verifyToken(token);
    // Resolve sub to the persisted user.id, since the JWT claim is opaque and
    // not guaranteed to match a row in `users`. ensureUser is idempotent and
    // returns the canonical id used by downstream lookups (e.g. OAuth grants).
    const userId = await this.authService.ensureUser(payload);
    setRequestUser(request, { ...payload, sub: userId });
    return true;
  }
}
