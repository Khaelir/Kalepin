import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { EncryptionZonesService } from './encryption-zones.service';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import { KEK_SOURCE, KEKSource } from '../crypto/kek-source';
import {
  encrypt,
  decrypt,
  hasEnvelopeMagic,
  EnvelopeKind,
} from '../crypto/envelope';
import { EncryptionZoneName } from '../entities/encryption-zone.entity';
import { PERSONAL_PREFIX } from '../auth/visibility';
import { skipSweepEntry } from './sweep-entry-filter';

export type SweepTarget = 'encrypt' | 'decrypt';

export class MigrationConflictError extends Error {
  constructor(zone: EncryptionZoneName) {
    super(`migration already in progress for zone "${zone}"`);
    this.name = 'MigrationConflictError';
  }
}

export class ZoneNotConfiguredError extends Error {
  constructor(zone: EncryptionZoneName) {
    super(`zone "${zone}" is not configured (missing physical root)`);
    this.name = 'ZoneNotConfiguredError';
  }
}

export class E2ESafetyError extends Error {
  constructor(zone: EncryptionZoneName, sample: string) {
    super(
      `cannot decrypt zone "${zone}" while E2E paths exist (e.g. ${sample})`,
    );
    this.name = 'E2ESafetyError';
  }
}

export class NoKEKError extends Error {
  constructor() {
    super('no KEK configured; cannot run encryption sweep');
    this.name = 'NoKEKError';
  }
}

export interface SweepOptions {
  /** Override roots for tests. */
  roots?: Partial<Record<EncryptionZoneName, string>>;
  /** Persist progress every N processed files (default 100). */
  persistEvery?: number;
}

const DEFAULT_PERSIST_EVERY = 100;
const PERSONAL_DIR_RESERVATION = '_users';

@Injectable()
export class MigrationSweepService implements OnApplicationBootstrap {
  private readonly logger = new Logger('MigrationSweepService');
  private readonly running = new Map<EncryptionZoneName, AbortController>();
  private readonly inFlight = new Map<EncryptionZoneName, Promise<void>>();
  private rootOverrides: Partial<Record<EncryptionZoneName, string>> = {};
  private persistEvery = DEFAULT_PERSIST_EVERY;

  constructor(
    private readonly zones: EncryptionZonesService,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates,
    @Optional() @Inject(KEK_SOURCE) private readonly kek: KEKSource | null,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.KALEPIN_RESUME_SWEEPS === '0') return;
    await this.backfillFingerprints();
    await this.resumeIfNeeded();
  }

  /**
   * Bind enabled zones to the active KEK fingerprint when they were seeded
   * with `kek_fingerprint = null` (fresh install with `personal=ON` by default).
   * Without this step the admin status endpoint reports `null`, which both
   * misrepresents the runtime — the encrypting adapter is wrapping all writes
   * with the active KEK regardless — and fails downstream consumers (admin UI,
   * tests) that expect a stable hex fingerprint as soon as a zone is enabled.
   * Disabled zones are left as-is (fingerprint stays null).
   */
  private async backfillFingerprints(): Promise<void> {
    if (!this.kek) return;
    for (const z of ['personal', 'shared'] as const) {
      const s = this.zones.get(z);
      if (!s.enabled) continue;
      if (s.kekFingerprint && s.kekFingerprint.equals(this.kek.fingerprint)) continue;
      await this.zones.set(z, { kekFingerprint: this.kek.fingerprint });
      this.logger.log(
        `bound zone ${z} to KEK fingerprint ${this.kek.fingerprint.toString('hex')}`,
      );
    }
  }

  /**
   * Configure root overrides and persist cadence (used by tests). Effective for
   * subsequent `start()` calls.
   */
  configure(opts: SweepOptions) {
    if (opts.roots) this.rootOverrides = { ...this.rootOverrides, ...opts.roots };
    if (opts.persistEvery !== undefined) this.persistEvery = opts.persistEvery;
  }

  /**
   * Start (or resume) a sweep. Returns immediately; the worker runs in the
   * background. The returned promise from `whenIdle(zone)` resolves when the
   * worker completes — useful for tests.
   */
  async start(zone: EncryptionZoneName, target: SweepTarget): Promise<void> {
    if (!this.kek) throw new NoKEKError();
    if (this.running.has(zone)) throw new MigrationConflictError(zone);

    const root = this.zoneRoot(zone);
    if (!root) throw new ZoneNotConfiguredError(zone);

    if (target === 'decrypt') {
      const sample = await this.findE2EPath(zone, root);
      if (sample) throw new E2ESafetyError(zone, sample);
    }

    // Flip enabled to the target state immediately so concurrent writes match
    // the new direction. Auto-detect on read makes mid-sweep state safe.
    const targetEnabled = target === 'encrypt';
    const migrationState = target === 'encrypt' ? 'encrypting' : 'decrypting';
    await this.zones.set(zone, {
      enabled: targetEnabled,
      migrationState,
      migrationStartedAt: Date.now(),
      migrationProgress: 0,
      migrationTotal: 0,
      kekFingerprint: targetEnabled ? this.kek.fingerprint : null,
    });

    const controller = new AbortController();
    this.running.set(zone, controller);

    const work = this.run(zone, target, root, controller.signal)
      .catch((err) => {
        this.logger.error(
          `sweep failed for zone ${zone}: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        this.running.delete(zone);
        this.inFlight.delete(zone);
      });
    this.inFlight.set(zone, work);
  }

  /** Resolves when the in-flight sweep for `zone` (if any) finishes. */
  whenIdle(zone: EncryptionZoneName): Promise<void> {
    return this.inFlight.get(zone) ?? Promise.resolve();
  }

  progress(zone: EncryptionZoneName) {
    const state = this.zones.get(zone);
    return {
      state: state.migrationState,
      progress: state.migrationProgress,
      total: state.migrationTotal,
    };
  }

  cancel(zone: EncryptionZoneName): boolean {
    const controller = this.running.get(zone);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Resume any zone that was mid-sweep when the process exited. The persisted
   * `migrationState` is the source of truth; `enabled` was already flipped to
   * the target on the first `start()`, so concurrent writes during the gap
   * matched the new direction.
   */
  async resumeIfNeeded(): Promise<void> {
    if (!this.kek) return;
    for (const z of ['personal', 'shared'] as const) {
      const s = this.zones.get(z);
      if (s.migrationState === 'idle') continue;
      const root = this.zoneRoot(z);
      if (!root) continue;
      const target: SweepTarget =
        s.migrationState === 'encrypting' ? 'encrypt' : 'decrypt';
      this.logger.log(
        `resuming ${target} sweep for zone ${z} from ${s.migrationProgress}/${s.migrationTotal}`,
      );
      const controller = new AbortController();
      this.running.set(z, controller);
      const work = this.run(z, target, root, controller.signal)
        .catch((err) => {
          this.logger.error(
            `resume failed for zone ${z}: ${(err as Error).message}`,
          );
        })
        .finally(() => {
          this.running.delete(z);
          this.inFlight.delete(z);
        });
      this.inFlight.set(z, work);
    }
  }

  private zoneRoot(zone: EncryptionZoneName): string | null {
    if (this.rootOverrides[zone] !== undefined) {
      return this.rootOverrides[zone] ?? null;
    }
    if (zone === 'personal') return process.env.PERSONAL_PATH || null;
    return process.env.VAULT_PATH || './data/vault';
  }

  private virtualPathFor(
    zone: EncryptionZoneName,
    physicalRel: string,
  ): string {
    return zone === 'personal'
      ? `${PERSONAL_PREFIX}${physicalRel}`
      : physicalRel;
  }

  private async findE2EPath(
    zone: EncryptionZoneName,
    root: string,
  ): Promise<string | null> {
    for await (const file of this.walk(root, zone)) {
      const v = this.virtualPathFor(zone, file);
      if (this.predicates.isE2EEncrypted(v)) return v;
    }
    return null;
  }

  private async run(
    zone: EncryptionZoneName,
    target: SweepTarget,
    root: string,
    signal: AbortSignal,
  ): Promise<void> {
    let total = 0;
    for await (const _f of this.walk(root, zone)) {
      total++;
      if (signal.aborted) return;
    }
    await this.zones.set(zone, { migrationTotal: total });

    let processed = 0;
    let sinceLastPersist = 0;

    for await (const physicalRel of this.walk(root, zone)) {
      if (signal.aborted) {
        await this.zones.set(zone, { migrationProgress: processed });
        this.logger.warn(
          `sweep aborted for ${zone} at ${processed}/${total}`,
        );
        return;
      }
      const absPath = path.join(root, physicalRel);
      const virtualPath = this.virtualPathFor(zone, physicalRel);

      try {
        if (this.predicates.isE2EEncrypted(virtualPath)) {
          processed++;
          continue;
        }
        await this.processFile(absPath, virtualPath, zone, target);
      } catch (err) {
        this.logger.error(
          `failed to process ${virtualPath}: ${(err as Error).message}`,
        );
      }

      processed++;
      sinceLastPersist++;
      if (sinceLastPersist >= this.persistEvery) {
        await this.zones.set(zone, { migrationProgress: processed });
        sinceLastPersist = 0;
      }
    }

    await this.zones.set(zone, {
      migrationState: 'idle',
      migrationProgress: processed,
      migrationTotal: total,
    });
    this.logger.log(
      `sweep complete for ${zone} (${target}): ${processed} files`,
    );
  }

  private async processFile(
    absPath: string,
    virtualPath: string,
    zone: EncryptionZoneName,
    target: SweepTarget,
  ): Promise<void> {
    const raw = await fs.readFile(absPath);
    const magic = hasEnvelopeMagic(raw);

    if (target === 'encrypt') {
      if (magic) return;
      const env = await encrypt(
        raw,
        virtualPath,
        this.kek!,
        zone,
        kindFor(virtualPath),
      );
      await atomicWrite(absPath, env);
    } else {
      if (!magic) return;
      const plain = await decrypt(raw, virtualPath, this.kek!);
      await atomicWrite(absPath, plain);
    }
  }

  /**
   * Walk the physical root yielding relative file paths. Skips dotfiles,
   * `.deleted/`, the reserved `_users/` segment at the root of the shared
   * vault, and `.tmp.*` leftovers. The zone trash folder is walked: trashed
   * notes are restorable and must follow the zone's encryption state.
   */
  private async *walk(
    root: string,
    zone: EncryptionZoneName,
  ): AsyncGenerator<string> {
    const stack: string[] = [''];
    while (stack.length) {
      const rel = stack.pop()!;
      const abs = path.join(root, rel);
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (skipSweepEntry(entry.name, entry.isDirectory(), rel, zone)) continue;
        if (
          zone === 'shared' &&
          rel === '' &&
          entry.name === PERSONAL_DIR_RESERVATION
        ) {
          continue;
        }
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          stack.push(childRel);
        } else if (entry.isFile()) {
          if (entry.name.includes('.tmp.')) continue;
          yield childRel;
        }
      }
    }
  }
}

function kindFor(virtualPath: string): EnvelopeKind {
  return virtualPath.includes('/_attachments/') ? 'attachment' : 'note';
}

async function atomicWrite(absPath: string, content: Buffer): Promise<void> {
  const dir = path.dirname(absPath);
  const tmp = `${absPath}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  await fs.mkdir(dir, { recursive: true });
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, absPath);
  // Durable semantics for the encryption sweep — fsync the parent directory so
  // the rename is committed past hard-power-loss. Mirrors
  // LocalFSAdapter.writeBytesAtomicDurable; sweep can take minutes and we don't
  // want a half-encrypted vault if power drops mid-run.
  const dirHandle = await fs.open(dir, 'r');
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}
