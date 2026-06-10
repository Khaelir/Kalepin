import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';
import * as Database from 'better-sqlite3';
import { BackupService } from './backup.service';
import { ArchiveService } from '../archive/archive.service';

// Helper to create a BackupService instance without NestJS DI
function createService(): BackupService {
  // SchedulerRegistry stub
  const schedulerRegistry = {
    addCronJob: () => {},
    getCronJob: () => ({ stop: () => {} }),
  };
  const archiveService = new ArchiveService();
  return new (BackupService as any)(schedulerRegistry, archiveService);
}

describe('BackupService', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('createArchive', () => {
    it('produces a valid .tar.gz with vault files and kalepin.sqlite', async () => {
      // Set up vault directory with test files
      const vaultPath = path.join(tmpDir, 'vault');
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(path.join(vaultPath, 'note1.md'), '# Hello');
      await fs.mkdir(path.join(vaultPath, '_attachments'));
      await fs.writeFile(path.join(vaultPath, '_attachments', 'img.png'), 'fake-png');
      await fs.mkdir(path.join(vaultPath, 'subfolder'));
      await fs.writeFile(path.join(vaultPath, 'subfolder', 'note2.md'), '# Sub');
      await fs.writeFile(path.join(vaultPath, '.collab'), 'sidecar-data');

      // Set up SQLite database with derived tables that should be stripped
      const dbPath = path.join(tmpDir, 'test.sqlite');
      const db = new Database(dbPath);
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      db.exec("INSERT INTO test VALUES (1, 'hello')");
      db.exec('CREATE TABLE note_embeddings (id INTEGER PRIMARY KEY, data BLOB)');
      db.exec("INSERT INTO note_embeddings VALUES (1, X'00')");
      db.exec('CREATE VIRTUAL TABLE notes_fts USING fts5(content)');
      db.exec("INSERT INTO notes_fts VALUES ('some indexed text')");
      db.exec('CREATE VIRTUAL TABLE comments_fts USING fts5(content)');
      db.exec("INSERT INTO comments_fts VALUES ('some comment text')");
      db.close();

      // Override env vars
      const origVault = process.env.VAULT_PATH;
      const origDb = process.env.DB_PATH;
      process.env.VAULT_PATH = vaultPath;
      process.env.DB_PATH = dbPath;

      try {
        const service = createService();
        const { archivePath, tmpDir: archiveTmpDir } = await service.createArchive();

        // Verify archive exists
        const stat = await fs.stat(archivePath);
        assert.ok(stat.size > 0, 'Archive should not be empty');

        // Extract and verify contents
        const extractDir = path.join(tmpDir, 'extracted');
        await fs.mkdir(extractDir);
        await tar.extract({ file: archivePath, cwd: extractDir });

        // Check vault files
        const note1 = await fs.readFile(path.join(extractDir, 'vault', 'note1.md'), 'utf8');
        assert.equal(note1, '# Hello');

        const img = await fs.readFile(path.join(extractDir, 'vault', '_attachments', 'img.png'), 'utf8');
        assert.equal(img, 'fake-png');

        const note2 = await fs.readFile(path.join(extractDir, 'vault', 'subfolder', 'note2.md'), 'utf8');
        assert.equal(note2, '# Sub');

        const collab = await fs.readFile(path.join(extractDir, 'vault', '.collab'), 'utf8');
        assert.equal(collab, 'sidecar-data');

        // Check SQLite backup — core data preserved, derived tables stripped
        const restoredDb = new Database(path.join(extractDir, 'kalepin.sqlite'), { readonly: true });
        const row = restoredDb.prepare('SELECT name FROM test WHERE id = 1').get() as any;
        assert.equal(row.name, 'hello');

        // Verify derived tables are absent from the archive
        const tables = restoredDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' OR type='virtual table'",
        ).all().map((r: any) => r.name);
        restoredDb.close();
        assert.ok(!tables.includes('note_embeddings'), 'note_embeddings should be stripped');
        assert.ok(!tables.includes('notes_fts'), 'notes_fts should be stripped');
        assert.ok(!tables.includes('comments_fts'), 'comments_fts should be stripped');

        // Cleanup archive tmp
        await fs.rm(archiveTmpDir, { recursive: true, force: true });
      } finally {
        if (origVault !== undefined) process.env.VAULT_PATH = origVault;
        else delete process.env.VAULT_PATH;
        if (origDb !== undefined) process.env.DB_PATH = origDb;
        else delete process.env.DB_PATH;
      }
    });
  });

  describe('env validation', () => {
    it('throws when required vars are partially set', () => {
      const origBucket = process.env.S3_BACKUP_BUCKET;
      const origRegion = process.env.S3_BACKUP_REGION;
      const origKey = process.env.S3_BACKUP_ACCESS_KEY_ID;
      const origSecret = process.env.S3_BACKUP_SECRET_ACCESS_KEY;

      process.env.S3_BACKUP_BUCKET = 'test-bucket';
      process.env.S3_BACKUP_REGION = 'us-east-1';
      delete process.env.S3_BACKUP_ACCESS_KEY_ID;
      delete process.env.S3_BACKUP_SECRET_ACCESS_KEY;

      try {
        const service = createService();
        assert.throws(
          () => (service as any).validateAndLoadConfig(),
          (err: Error) => {
            assert.ok(err.message.includes('S3_BACKUP_ACCESS_KEY_ID'));
            assert.ok(err.message.includes('S3_BACKUP_SECRET_ACCESS_KEY'));
            return true;
          },
        );
      } finally {
        if (origBucket !== undefined) process.env.S3_BACKUP_BUCKET = origBucket;
        else delete process.env.S3_BACKUP_BUCKET;
        if (origRegion !== undefined) process.env.S3_BACKUP_REGION = origRegion;
        else delete process.env.S3_BACKUP_REGION;
        if (origKey !== undefined) process.env.S3_BACKUP_ACCESS_KEY_ID = origKey;
        else delete process.env.S3_BACKUP_ACCESS_KEY_ID;
        if (origSecret !== undefined) process.env.S3_BACKUP_SECRET_ACCESS_KEY = origSecret;
        else delete process.env.S3_BACKUP_SECRET_ACCESS_KEY;
      }
    });
  });

  describe('mutex', () => {
    it('prevents concurrent backup runs', async () => {
      const service = createService();

      // Simulate backup in progress by setting the flag
      (service as any).backupInProgress = true;

      await assert.rejects(
        () => service.runBackup(),
        (err: Error) => {
          assert.ok(err.message.includes('already in progress'));
          return true;
        },
      );

      // Verify flag is still set (not cleared by the rejected call)
      assert.equal(service.isBackupInProgress, true);
    });
  });

  describe('pruneOldBackups', () => {
    it('correctly identifies old backups for deletion', async () => {
      const service = createService();
      const now = new Date();
      const oldDate = new Date(now);
      oldDate.setDate(oldDate.getDate() - 60); // 60 days ago
      const recentDate = new Date(now);
      recentDate.setDate(recentDate.getDate() - 5); // 5 days ago

      // Set up config with 30-day retention
      (service as any).config = {
        bucket: 'test-bucket',
        prefix: 'backups',
        retentionDays: 30,
      };

      // Track S3 calls
      const deletedKeys: string[] = [];
      (service as any).s3 = {
        send: async (cmd: any) => {
          if (cmd.constructor.name === 'ListObjectsV2Command') {
            return {
              Contents: [
                { Key: 'backups/kalepin-backup-old.tar.gz', LastModified: oldDate, Size: 100 },
                { Key: 'backups/kalepin-backup-recent.tar.gz', LastModified: recentDate, Size: 200 },
              ],
            };
          }
          if (cmd.constructor.name === 'DeleteObjectsCommand') {
            deletedKeys.push(...cmd.input.Delete.Objects.map((o: any) => o.Key));
            return {};
          }
        },
      };

      const pruned = await service.pruneOldBackups();
      assert.equal(pruned, 1);
      assert.deepEqual(deletedKeys, ['backups/kalepin-backup-old.tar.gz']);
    });

    it('skips pruning when retention days is 0', async () => {
      const service = createService();
      (service as any).config = {
        bucket: 'test-bucket',
        prefix: 'backups',
        retentionDays: 0,
      };

      const pruned = await service.pruneOldBackups();
      assert.equal(pruned, 0);
    });
  });

  describe('restoreFromS3', () => {
    it('restores vault and DB from a backup archive', async () => {
      // Set up current vault and DB
      const vaultPath = path.join(tmpDir, 'vault');
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(path.join(vaultPath, 'current.md'), '# Current');

      const dbDir = path.join(tmpDir, 'db');
      await fs.mkdir(dbDir, { recursive: true });
      const dbPath = path.join(dbDir, 'kalepin.sqlite');
      const currentDb = new Database(dbPath);
      currentDb.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      currentDb.exec("INSERT INTO test VALUES (1, 'current')");
      currentDb.close();

      // Create a backup archive (simulating what S3 would return)
      const backupDir = path.join(tmpDir, 'backup-staging');
      await fs.mkdir(backupDir);
      const backupVault = path.join(backupDir, 'vault');
      await fs.mkdir(backupVault);
      await fs.writeFile(path.join(backupVault, 'restored.md'), '# Restored');
      const backupDbPath = path.join(backupDir, 'kalepin.sqlite');
      const backupDb = new Database(backupDbPath);
      backupDb.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      backupDb.exec("INSERT INTO test VALUES (1, 'restored')");
      backupDb.close();

      const archivePath = path.join(tmpDir, 'test-backup.tar.gz');
      await tar.create({ gzip: true, file: archivePath, cwd: backupDir }, ['vault', 'kalepin.sqlite']);

      // Override env vars
      const origVault = process.env.VAULT_PATH;
      const origDb = process.env.DB_PATH;
      process.env.VAULT_PATH = vaultPath;
      process.env.DB_PATH = dbPath;

      try {
        const service = createService();
        (service as any).config = { bucket: 'test-bucket', prefix: 'backups' };

        // Mock S3 GetObject to return our archive
        const archiveBuffer = await fs.readFile(archivePath);
        const { Readable } = await import('stream');
        (service as any).s3 = {
          send: async () => ({
            Body: Readable.from(archiveBuffer),
          }),
        };

        await service.restoreFromS3('backups/test-backup.tar.gz');

        // Verify vault was replaced
        const files = await fs.readdir(vaultPath);
        assert.ok(files.includes('restored.md'), 'restored.md should exist');
        assert.ok(!files.includes('current.md'), 'current.md should be gone');
        const content = await fs.readFile(path.join(vaultPath, 'restored.md'), 'utf8');
        assert.equal(content, '# Restored');

        // Verify DB was replaced
        const restoredDb = new Database(dbPath, { readonly: true });
        const row = restoredDb.prepare('SELECT name FROM test WHERE id = 1').get() as any;
        restoredDb.close();
        assert.equal(row.name, 'restored');
      } finally {
        if (origVault !== undefined) process.env.VAULT_PATH = origVault;
        else delete process.env.VAULT_PATH;
        if (origDb !== undefined) process.env.DB_PATH = origDb;
        else delete process.env.DB_PATH;
      }
    });
  });
});
