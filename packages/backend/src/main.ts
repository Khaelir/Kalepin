import { NestFactory } from '@nestjs/core';
import { Logger, LogLevel } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { createAppUrlWarningMiddleware } from './auth/oauth/app-url-warning';
import { createOAuthCorsMiddleware } from './auth/oauth/oauth-cors';
import { createSecurityHeadersMiddleware } from './security-headers';

function resolveLogLevels(level: string): LogLevel[] {
  switch (level) {
    case 'verbose': return ['verbose', 'debug', 'log', 'warn', 'error'];
    case 'debug':   return ['debug', 'log', 'warn', 'error'];
    case 'warn':    return ['warn', 'error'];
    case 'error':   return ['error'];
    default:        return ['log', 'warn', 'error']; // 'info' / default
  }
}

async function bootstrap() {
  const logLevel = process.env.LOG_LEVEL || 'info';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: resolveLogLevels(logLevel),
  });
  app.useWebSocketAdapter(new WsAdapter(app));

  // Trust the reverse proxy (Traefik in production) so req.protocol /
  // X-Forwarded-* headers reflect the original client request. Required for
  // OAuth discovery URLs to advertise https:// when fronted by TLS termination
  // and for the APP_URL drift warning below to mean anything.
  app.set('trust proxy', true);

  // Boot-time check: log a loud warning if APP_URL diverges from the protocol
  // or host the proxy is forwarding. The most common self-hosted footgun.
  app.use(
    createAppUrlWarningMiddleware({
      appUrl: process.env.APP_URL || 'http://localhost:3000',
      logger: new Logger('AppUrlCheck'),
    }),
  );

  // CORS for the OAuth + MCP surfaces only. The rest of the API stays
  // first-party — see design.md Decision 7. Mounted before NestJS controllers
  // so OPTIONS preflights short-circuit cleanly.
  app.use(createOAuthCorsMiddleware());

  // Baseline HTTP security headers (CSP, X-Frame-Options, nosniff, HSTS, etc.).
  // Mounted before the /drawio override so per-route handlers can replace
  // specific headers (the drawio embed page does so for CSP).
  app.use(createSecurityHeadersMiddleware());

  // draw.io runs in a sandboxed iframe (opaque origin), so CSP 'self' doesn't work.
  // Set CORS + CSP headers server-side with the real origin.
  app.use('/drawio', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.path === '/embed.html') {
      const proto = req.get('x-forwarded-proto') || req.protocol;
      const origin = `${proto}://${req.get('host')}`;
      // The drawio embed must be iframable from the same origin — override the
      // baseline `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader(
        'Content-Security-Policy',
        `default-src ${origin} blob: data: 'unsafe-inline' 'unsafe-eval'; ` +
        `connect-src ${origin} blob: data:; ` +
        `img-src ${origin} blob: data:; ` +
        `font-src ${origin} data:; ` +
        `frame-ancestors 'self'`,
      );
    }
    next();
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Kalepin running on http://localhost:${port} (log level: ${logLevel})`);
}
bootstrap();
