import { Module, Global, Logger } from '@nestjs/common';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { STORAGE_ADAPTER, StorageAdapter } from './storage-adapter.interface';
import { LocalFSAdapter, assertVaultWritableAndSyncable } from './local-fs.adapter';
import { GitAdapter } from './git.adapter';
import { RoutingStorageAdapter } from './routing-fs.adapter';
import { EncryptingStorageAdapter } from './encrypting-fs.adapter';
import {
  KEKSource,
  FileKEKSource,
  EnvKEKSource,
  KEK_LENGTH_BYTES,
  KEK_SOURCE,
} from '../crypto/kek-source';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';

const PERSONAL_DIR_RESERVATION = '_users';

function assertNoReservedUsersDir(vaultPath: string) {
  const reserved = path.join(vaultPath, PERSONAL_DIR_RESERVATION);
  if (fsSync.existsSync(reserved)) {
    throw new Error(
      `Refusing to start: ${reserved} exists on disk. The path "_users/" is reserved for the personal-folder virtual namespace and must not exist physically inside VAULT_PATH. Move or delete it before booting.`,
    );
  }
}

function buildBaseAdapter(): StorageAdapter {
  const logger = new Logger('StorageModule');
  const vaultPath = process.env.VAULT_PATH || './data/vault';
  const personalPath = process.env.PERSONAL_PATH;
  const adapterType = (process.env.STORAGE_ADAPTER || 'localfs').toLowerCase();

  if (adapterType === 'git') {
    return new GitAdapter(vaultPath);
  }

  // localfs (default)
  assertNoReservedUsersDir(vaultPath);
  // Surface fsync misconfiguration loudly at boot rather than at first durable
  // write. The probe writes/syncs/deletes a sentinel file in the vault root.
  assertVaultWritableAndSyncable(vaultPath);
  const shared = new LocalFSAdapter(vaultPath);

  if (!personalPath) {
    return shared;
  }

  if (!fsSync.existsSync(personalPath)) {
    fsSync.mkdirSync(personalPath, { recursive: true });
  }
  assertVaultWritableAndSyncable(personalPath);
  const personal = new LocalFSAdapter(personalPath);
  logger.log(`Routing storage adapter active (vault=${vaultPath}, personal=${personalPath})`);
  return new RoutingStorageAdapter(shared, personal);
}

/**
 * Resolve a KEK source from environment configuration:
 *
 *   - `KALEPIN_KEK_FILE`: path to a 0400/0600 32-byte file. Always preferred.
 *   - `KALEPIN_KEK_AUTO_GENERATE=1` (dev convenience): if `KALEPIN_KEK_FILE` is
 *     set but the file does not exist, generate a fresh KEK at 0600 and use it.
 *   - `KALEPIN_KEK`: hex-encoded 32 bytes, dev/test only (refused in production
 *     unless `KALEPIN_KEK_FILE` is also set, which makes the env value moot).
 *   - none of the above: returns `null` and the storage adapter is left
 *     plaintext-only (no encryption boundary). This keeps existing development
 *     workflows working without forced KEK setup.
 */
function resolveKEKSource(logger: Logger): KEKSource | null {
  const filePath = process.env.KALEPIN_KEK_FILE;
  if (filePath) {
    if (!fsSync.existsSync(filePath) && process.env.KALEPIN_KEK_AUTO_GENERATE === '1') {
      logger.warn(`KALEPIN_KEK_FILE missing; auto-generating fresh KEK at ${filePath} (dev convenience).`);
      const dir = path.dirname(filePath);
      fsSync.mkdirSync(dir, { recursive: true });
      const fresh = crypto.randomBytes(KEK_LENGTH_BYTES);
      fsSync.writeFileSync(filePath, fresh, { mode: 0o600 });
      fsSync.chmodSync(filePath, 0o600);
    }
    const src = new FileKEKSource(filePath);
    logger.log(`KEK source: file (${filePath}); fingerprint=${src.fingerprint.toString('hex')}`);
    return src;
  }
  if (process.env.KALEPIN_KEK) {
    const src = new EnvKEKSource();
    logger.log(`KEK source: env (KALEPIN_KEK); fingerprint=${src.fingerprint.toString('hex')}`);
    return src;
  }
  return null;
}

@Global()
@Module({
  providers: [
    {
      provide: KEK_SOURCE,
      useFactory: (): KEKSource | null => {
        const logger = new Logger('StorageModule');
        return resolveKEKSource(logger);
      },
    },
    {
      provide: STORAGE_ADAPTER,
      inject: [ENCRYPTION_PREDICATES, KEK_SOURCE],
      useFactory: (
        predicates: EncryptionPredicates,
        kek: KEKSource | null,
      ): StorageAdapter => {
        const logger = new Logger('StorageModule');
        const base = buildBaseAdapter();
        if (!kek) {
          logger.log('No KEK configured; storage adapter is plaintext-only.');
          return base;
        }
        if (!base.readBytes || !base.writeBytes || !base.writeBytesAtomic) {
          logger.warn(
            'Inner storage adapter does not implement readBytes/writeBytes/writeBytesAtomic; encryption disabled.',
          );
          return base;
        }
        logger.log('EncryptingStorageAdapter wrapping the base adapter.');
        return new EncryptingStorageAdapter(base, kek, predicates);
      },
    },
  ],
  exports: [STORAGE_ADAPTER, KEK_SOURCE],
})
export class StorageModule {}

// keep imports referenced for declaration emission
void fs;
