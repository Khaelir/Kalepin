import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SecureVaultService } from './secure-vault.service';

/**
 * Hourly sweep that finalizes any tombstoned `_secure/` vaults whose 24h
 * grace window has elapsed. Idempotent — safe to run repeatedly.
 */
@Injectable()
export class SecureVaultSweepService {
  private readonly logger = new Logger(SecureVaultSweepService.name);

  constructor(private readonly secureVault: SecureVaultService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const result = await this.secureVault.runTombstoneSweep();
    if (result.finalized > 0 || result.failed > 0) {
      this.logger.log(
        `vault-tombstone sweep: finalized=${result.finalized} failed=${result.failed}`,
      );
    }
  }
}
