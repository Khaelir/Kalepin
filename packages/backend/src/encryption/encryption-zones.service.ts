import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EncryptionZone,
  EncryptionZoneName,
  MigrationState,
} from '../entities/encryption-zone.entity';

export interface ZoneState {
  zone: EncryptionZoneName;
  enabled: boolean;
  kekFingerprint: Buffer | null;
  migrationState: MigrationState;
  migrationProgress: number;
  migrationTotal: number;
  migrationStartedAt: number | null;
  updatedAt: number;
}

const DEFAULTS: Record<EncryptionZoneName, { enabled: number }> = {
  personal: { enabled: 1 },
  shared: { enabled: 0 },
};

const ZONES: EncryptionZoneName[] = ['personal', 'shared'];
const CACHE_TTL_MS = 1000;

@Injectable()
export class EncryptionZonesService implements OnModuleInit {
  private readonly logger = new Logger('EncryptionZonesService');
  private readonly cache = new Map<EncryptionZoneName, ZoneState>();
  private cachedAt = 0;
  private initialized = false;

  constructor(
    @InjectRepository(EncryptionZone)
    private readonly repo: Repository<EncryptionZone>,
  ) {}

  async onModuleInit() {
    await this.seed();
    await this.refresh();
    this.initialized = true;
  }

  /**
   * Test-only: skip Nest lifecycle but ensure the cache is populated. Used by
   * unit tests that build the service directly without booting the module.
   */
  async initForTests() {
    await this.seed();
    await this.refresh();
    this.initialized = true;
  }

  private async seed() {
    for (const zone of ZONES) {
      const existing = await this.repo.findOneBy({ zone });
      if (existing) continue;
      const row = this.repo.create({
        zone,
        enabled: DEFAULTS[zone].enabled,
        kekFingerprint: null,
        migrationState: 'idle',
        migrationProgress: 0,
        migrationTotal: 0,
        migrationStartedAt: null,
        updatedAt: Date.now(),
      });
      await this.repo.save(row);
    }
  }

  private async refresh() {
    const rows = await this.repo.find();
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.zone, this.toState(row));
    }
    this.cachedAt = Date.now();
  }

  private toState(row: EncryptionZone): ZoneState {
    return {
      zone: row.zone,
      enabled: !!row.enabled,
      kekFingerprint: row.kekFingerprint,
      migrationState: row.migrationState,
      migrationProgress: row.migrationProgress,
      migrationTotal: row.migrationTotal,
      migrationStartedAt: row.migrationStartedAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Sync read of cached zone state. Throws if the cache is empty. */
  get(zone: EncryptionZoneName): ZoneState {
    if (!this.initialized) {
      throw new Error('EncryptionZonesService not initialized; call onModuleInit() or initForTests()');
    }
    const state = this.cache.get(zone);
    if (!state) throw new Error(`unknown encryption zone "${zone}"`);
    // Hot-path TTL refresh: if cache exceeds TTL, schedule async refresh but
    // return current value so the call stays sync.
    if (Date.now() - this.cachedAt > CACHE_TTL_MS) {
      void this.refresh().catch((err) =>
        this.logger.warn(`zone refresh failed: ${(err as Error).message}`),
      );
    }
    return state;
  }

  /** Sync convenience for predicates. */
  isEnabled(zone: EncryptionZoneName): boolean {
    return this.get(zone).enabled;
  }

  async list(): Promise<ZoneState[]> {
    return ZONES.map((z) => this.get(z));
  }

  async set(zone: EncryptionZoneName, fields: Partial<ZoneState>): Promise<ZoneState> {
    const update: Partial<EncryptionZone> = { updatedAt: Date.now() };
    if (fields.enabled !== undefined) update.enabled = fields.enabled ? 1 : 0;
    if (fields.kekFingerprint !== undefined) update.kekFingerprint = fields.kekFingerprint;
    if (fields.migrationState !== undefined) update.migrationState = fields.migrationState;
    if (fields.migrationProgress !== undefined) update.migrationProgress = fields.migrationProgress;
    if (fields.migrationTotal !== undefined) update.migrationTotal = fields.migrationTotal;
    if (fields.migrationStartedAt !== undefined) update.migrationStartedAt = fields.migrationStartedAt;
    await this.repo.update({ zone }, update);
    const row = await this.repo.findOneByOrFail({ zone });
    const state = this.toState(row);
    this.cache.set(zone, state);
    this.cachedAt = Date.now();
    return state;
  }
}
