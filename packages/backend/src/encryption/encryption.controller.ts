import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  UseGuards,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../auth';
import { RequiredScope } from '../auth/required-scope.decorator';
import { EncryptionZonesService } from './encryption-zones.service';
import {
  MigrationSweepService,
  MigrationConflictError,
  ZoneNotConfiguredError,
  E2ESafetyError,
  NoKEKError,
} from './migration-sweep.service';
import { EncryptionZoneName } from '../entities/encryption-zone.entity';

/**
 * Lightweight, non-admin status endpoint. Returns just the per-zone enabled
 * flag — no fingerprints, no migration counters. Used by the sidebar to show
 * the lock cue on the VAULT section title; visible to any authenticated user.
 */
@Controller('api/encryption')
@UseGuards(CombinedAuthGuard)
export class EncryptionStatusController {
  constructor(private readonly zones: EncryptionZonesService) {}

  @Get('/status')
  async status() {
    const list = await this.zones.list();
    const out: Record<string, boolean> = {};
    for (const z of list) out[z.zone] = z.enabled;
    return { zones: out };
  }
}

@Controller('api/admin/encryption')
@UseGuards(CombinedAuthGuard)
export class EncryptionController {
  constructor(
    private readonly zones: EncryptionZonesService,
    private readonly sweep: MigrationSweepService,
  ) {}

  @Get()
  @RequiredScope('admin:backup')
  async state() {
    const list = await this.zones.list();
    return {
      zones: list.map((z) => ({
        zone: z.zone,
        enabled: z.enabled,
        kek_fingerprint: z.kekFingerprint
          ? z.kekFingerprint.toString('hex')
          : null,
        migration_state: z.migrationState,
        migration_progress: z.migrationProgress,
        migration_total: z.migrationTotal,
        migration_started_at: z.migrationStartedAt,
      })),
    };
  }

  @Post('zones/:zone/encrypt')
  @HttpCode(202)
  @RequiredScope('admin:backup')
  async encryptZone(@Param('zone') zone: string) {
    const z = this.assertZone(zone);
    return this.startSafe(z, 'encrypt');
  }

  @Post('zones/:zone/decrypt')
  @HttpCode(202)
  @RequiredScope('admin:backup')
  async decryptZone(@Param('zone') zone: string) {
    const z = this.assertZone(zone);
    return this.startSafe(z, 'decrypt');
  }

  private async startSafe(zone: EncryptionZoneName, target: 'encrypt' | 'decrypt') {
    try {
      await this.sweep.start(zone, target);
    } catch (err) {
      if (err instanceof MigrationConflictError) {
        throw new ConflictException(err.message);
      }
      if (err instanceof E2ESafetyError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof ZoneNotConfiguredError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof NoKEKError) {
        throw new ServiceUnavailableException(err.message);
      }
      throw new InternalServerErrorException(
        (err as Error).message ?? 'sweep failed to start',
      );
    }
    return {
      zone,
      target,
      state: this.sweep.progress(zone),
    };
  }

  private assertZone(zone: string): EncryptionZoneName {
    if (zone !== 'personal' && zone !== 'shared') {
      throw new BadRequestException(`unknown zone "${zone}"`);
    }
    return zone;
  }
}
