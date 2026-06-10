import { Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

// Catches the most common self-hosted footgun: APP_URL mis-set when running
// behind Traefik (or any reverse proxy doing TLS termination). When this drifts
// from `X-Forwarded-Proto` / `X-Forwarded-Host`, OAuth discovery advertises the
// wrong issuer and claude.ai's connector flow fails before reaching us.
//
// Implementation: inspect every inbound request's forwarded headers, log a WARN
// if they disagree with APP_URL, and throttle to one warning per minute so a
// genuine misconfig surfaces quickly without spamming logs.
const WARN_THROTTLE_MS = 60_000;

export interface AppUrlWarningDeps {
  appUrl: string;
  logger: Pick<Logger, 'warn'>;
  now?: () => number;
}

export function createAppUrlWarningMiddleware(deps: AppUrlWarningDeps) {
  let parsed: URL;
  try {
    parsed = new URL(deps.appUrl);
  } catch {
    deps.logger.warn(`APP_URL="${deps.appUrl}" is not a valid URL; OAuth discovery will use it verbatim and likely fail.`);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const expectedProto = parsed.protocol.replace(':', '');
  const expectedHost = parsed.host;
  const now = deps.now ?? (() => Date.now());
  let lastWarnedAt = 0;

  return (req: Request, _res: Response, next: NextFunction) => {
    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();

    // No proxy involved — nothing useful to compare against.
    if (!forwardedProto && !forwardedHost) {
      next();
      return;
    }

    const protoMismatch = forwardedProto && forwardedProto !== expectedProto;
    const hostMismatch = forwardedHost && forwardedHost !== expectedHost;

    if (protoMismatch || hostMismatch) {
      const ts = now();
      if (ts - lastWarnedAt >= WARN_THROTTLE_MS) {
        lastWarnedAt = ts;
        const observed = `${forwardedProto ?? expectedProto}://${forwardedHost ?? expectedHost}`;
        deps.logger.warn(
          `APP_URL=${deps.appUrl} but inbound request shows X-Forwarded-Proto=${forwardedProto ?? '(unset)'}, ` +
            `X-Forwarded-Host=${forwardedHost ?? '(unset)'}. OAuth discovery metadata will advertise the wrong issuer; ` +
            `claude.ai connectors will fail. Update APP_URL to ${observed}.`,
        );
      }
    }

    next();
  };
}
