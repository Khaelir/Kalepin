import { Injectable, Logger } from '@nestjs/common';
import * as tar from 'tar';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as Database from 'better-sqlite3';

@Injectable()
export class ArchiveService {
  private readonly logger = new Logger(ArchiveService.name);

  async createArchive(): Promise<{ archivePath: string; tmpDir: string }> {
    const vaultPath = path.resolve(process.env.VAULT_PATH || './data/vault');
    const personalPath = process.env.PERSONAL_PATH ? path.resolve(process.env.PERSONAL_PATH) : undefined;
    const dbPath = process.env.DB_PATH || './data/kalepin.sqlite';
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kalepin-backup-'));
    const archivePath = path.join(tmpDir, 'backup.tar.gz');

    const stagingDir = path.join(tmpDir, 'staging');
    await fs.promises.mkdir(stagingDir);

    try {
      // 1. SQLite consistent backup
      const dbBackupPath = path.join(stagingDir, 'kalepin.sqlite');
      const db = new Database(dbPath, { readonly: true });
      try {
        await db.backup(dbBackupPath);
      } finally {
        db.close();
      }

      // 2. Strip derived tables (embeddings + FTS) -- they're rebuilt on boot
      const backupDb = new Database(dbBackupPath);
      try {
        backupDb.exec('DROP TABLE IF EXISTS note_embeddings');
        backupDb.exec('DROP TABLE IF EXISTS notes_fts');
        backupDb.exec('DROP TABLE IF EXISTS comments_fts');
        backupDb.exec('VACUUM');
      } finally {
        backupDb.close();
      }

      // 3. Symlink vault into staging dir so tar picks it up
      await fs.promises.symlink(vaultPath, path.join(stagingDir, 'vault'));

      // 3b. Symlink personal/ if configured. When unset, the archive is vault-only
      // (preserves backward compatibility for single-tenant deployments).
      const archiveEntries = ['vault', 'kalepin.sqlite'];
      if (personalPath) {
        try {
          await fs.promises.access(personalPath);
          await fs.promises.symlink(personalPath, path.join(stagingDir, 'personal'));
          archiveEntries.push('personal');
        } catch {
          // PERSONAL_PATH set but directory missing — skip (idempotent).
        }
      }

      // 4. Create tar.gz from the staging directory
      await tar.create(
        {
          gzip: true,
          file: archivePath,
          cwd: stagingDir,
          follow: true,
        },
        archiveEntries,
      );

      return { archivePath, tmpDir };
    } catch (err) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  async restoreFromArchive(filePath: string): Promise<void> {
    const vaultPath = path.resolve(process.env.VAULT_PATH || './data/vault');
    const personalPath = process.env.PERSONAL_PATH ? path.resolve(process.env.PERSONAL_PATH) : undefined;
    const dbPath = path.resolve(process.env.DB_PATH || './data/kalepin.sqlite');
    const dataDir = path.dirname(vaultPath);

    const stagingDir = path.join(dataDir, 'staging-restore');
    await fs.promises.rm(stagingDir, { recursive: true, force: true });
    await fs.promises.mkdir(stagingDir, { recursive: true });

    try {
      // 1. Extract archive
      await tar.extract({ file: filePath, cwd: stagingDir });

      // 2. Vault content swap
      // Vault is a Docker volume (separate device), so rename() across devices fails.
      // Keep the backup inside the vault volume itself to stay on the same device.
      const stagedVault = path.join(stagingDir, 'vault');
      const oldVault = path.join(vaultPath, '.restore-backup');

      await fs.promises.access(stagedVault);

      // Move current vault contents to backup dir (same device — rename works)
      await fs.promises.rm(oldVault, { recursive: true, force: true });
      await fs.promises.mkdir(oldVault);
      const existingEntries = await fs.promises.readdir(vaultPath);
      for (const entry of existingEntries) {
        if (entry === '.restore-backup') continue;
        await fs.promises.rename(path.join(vaultPath, entry), path.join(oldVault, entry));
      }

      // Copy staged vault contents into vault (cross-device, so use cp)
      try {
        const newEntries = await fs.promises.readdir(stagedVault);
        for (const entry of newEntries) {
          await fs.promises.cp(path.join(stagedVault, entry), path.join(vaultPath, entry), { recursive: true });
        }
      } catch (err) {
        // Rollback: move old contents back (same device)
        const rollbackEntries = await fs.promises.readdir(oldVault);
        for (const entry of rollbackEntries) {
          await fs.promises.rename(path.join(oldVault, entry), path.join(vaultPath, entry));
        }
        throw err;
      }
      await fs.promises.rm(oldVault, { recursive: true, force: true });

      // 2b. Personal-root content swap, only if both PERSONAL_PATH is set and the
      // archive contained a personal/ directory. Symmetric to vault swap.
      const stagedPersonal = path.join(stagingDir, 'personal');
      const archiveHasPersonal = await fs.promises.access(stagedPersonal).then(() => true).catch(() => false);
      if (personalPath && archiveHasPersonal) {
        await fs.promises.mkdir(personalPath, { recursive: true });
        const oldPersonal = path.join(personalPath, '.restore-backup');
        await fs.promises.rm(oldPersonal, { recursive: true, force: true });
        await fs.promises.mkdir(oldPersonal);
        const existingPersonal = await fs.promises.readdir(personalPath);
        for (const entry of existingPersonal) {
          if (entry === '.restore-backup') continue;
          await fs.promises.rename(path.join(personalPath, entry), path.join(oldPersonal, entry));
        }
        try {
          const newEntries = await fs.promises.readdir(stagedPersonal);
          for (const entry of newEntries) {
            await fs.promises.cp(path.join(stagedPersonal, entry), path.join(personalPath, entry), { recursive: true });
          }
        } catch (err) {
          const rollbackEntries = await fs.promises.readdir(oldPersonal);
          for (const entry of rollbackEntries) {
            await fs.promises.rename(path.join(oldPersonal, entry), path.join(personalPath, entry));
          }
          throw err;
        }
        await fs.promises.rm(oldPersonal, { recursive: true, force: true });
      }

      // 3. DB swap (cross-device, so use cp + unlink)
      const stagedDb = path.join(stagingDir, 'kalepin.sqlite');
      await fs.promises.access(stagedDb);
      await fs.promises.copyFile(stagedDb, dbPath);

      this.logger.log('Restore complete from uploaded archive');
    } finally {
      await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
