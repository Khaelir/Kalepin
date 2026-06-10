import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthService, JwtPayload } from './auth.service';
import { setRequestUser } from './request-user';
import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient();
    const request: IncomingMessage = client._req || client.upgradeReq;

    let token: string | undefined;

    // Try query parameter first
    if (request.url) {
      const parsed = parseUrl(request.url, true);
      token = parsed.query.token as string;
    }

    // Then try Authorization header
    if (!token) {
      const authHeader = request.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      client.close(4001, 'Unauthorized');
      return false;
    }

    try {
      const payload: JwtPayload = this.authService.verifyToken(token);
      setRequestUser(client, payload);
      return true;
    } catch {
      client.close(4001, 'Unauthorized');
      return false;
    }
  }
}
