import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SsoService } from './sso.service';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Keeps `sso_login_requests` small, like `OAuthSweepService` for OAuth requests. */
@Injectable()
export class SsoSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SsoSweepService.name);
  private interval?: ReturnType<typeof setInterval>;

  constructor(private readonly sso: SsoService) {}

  onModuleInit(): void {
    this.interval = setInterval(() => {
      this.sso
        .sweep()
        .then((deleted) => {
          if (deleted > 0) this.logger.debug(`SSO sweep: deleted ${deleted} login requests`);
        })
        .catch((err: Error) => this.logger.warn(`SSO sweep failed: ${err.message}`));
    }, SWEEP_INTERVAL_MS);
    this.interval.unref();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }
}
