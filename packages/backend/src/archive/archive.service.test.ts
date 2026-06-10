import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';
import * as Database from 'better-sqlite3';
import { ArchiveService } from './archive.service';

describe('ArchiveService', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('createArchive', () => {
    it('produces a valid .tar.gz with vault files and stripped DB', async () => {
      // Set up vault
      const vaultPath = path.join(tmpDir, 'vault');
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(path.join(vaultPath, 'note1.md'), '# Hello');
      await fs.mkdir(path.join(vaultPath, 'subfolder'));
      await fs.writeFile(path.join(vaultPath, 'subfolder', 'note2.md'), '# Sub');

      // Set up DB with derived tables
      const dbPath = path.join(tmpDir, 'test.sqlite');
      const db = new Database(dbPath);
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      db.exec("INSERT INTO test VALUES (1, 'hello')");
      db.exec('CREATE TABLE note_embeddings (id INTEGER PRIMARY KEY, data BLOB)');
      db.exec("INSERT INTO note_embeddings VALUES (1, X'00')");
      db.exec('CREATE VIRTUAL TABLE notes_fts USING fts5(content)');
      db.exec("INSERT INTO notes_fts VALUES ('indexed')");
      db.exec('CREATE VIRTUAL TABLE comments_fts USING fts5(content)');
      db.exec("INSERT INTO comments_fts VALUES ('comment')");
      db.close();

      const origVault = process.env.VAULT_PATH;
      const origDb = process.env.DB_PATH;
      process.env.VAULT_PATH = vaultPath;
      process.env.DB_PATH = dbPath;

      try {
        const service = new ArchiveService();
        const { archivePath, tmpDir: archiveTmpDir } = await service.createArchive();

        const stat = await fs.stat(archivePath);
        assert.ok(stat.size > 0);

        // Extract and verify
        const extractDir = path.join(tmpDir, 'extracted');
        await fs.mkdir(extractDir);
        await tar.extract({ file: archivePath, cwd: extractDir });

        // Vault files preserved
        const note1 = await fs.readFile(path.join(extractDir, 'vault', 'note1.md'), 'utf8');
        assert.equal(note1, '# Hello');
        const note2 = await fs.readFile(path.join(extractDir, 'vault', 'subfolder', 'note2.md'), 'utf8');
        assert.equal(note2, '# Sub');

        // DB: core data preserved, derived tables stripped
        const restoredDb = new Database(path.join(extractDir, 'kalepin.sqlite'), { readonly: true });
        const row = restoredDb.prepare('SELECT name FROM test WHERE id = 1').get() as any;
        assert.equal(row.name, 'hello');

        const tables = restoredDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' OR type='virtual table'",
        ).all().map((r: any) => r.name);
        restoredDb.close();
        assert.ok(!tables.includes('note_embeddings'));
        assert.ok(!tables.includes('notes_fts'));
        assert.ok(!tables.includes('comments_fts'));

        await fs.rm(archiveTmpDir, { recursive: true, force: true });
      } finally {
        if (origVault !== undefined) process.env.VAULT_PATH = origVault;
        else delete process.env.VAULT_PATH;
        if (origDb !== undefined) process.env.DB_PATH = origDb;
        else delete process.env.DB_PATH;
      }
    });
  });

  describe('restoreFromArchive', () => {
    it('performs atomic vault and DB swap', async () => {
      // Current vault and DB
      const vaultPath = path.join(tmpDir, 'vault');
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(path.join(vaultPath, 'current.md'), '# Current');

      const dbPath = path.join(tmpDir, 'kalepin.sqlite');
      const currentDb = new Database(dbPath);
      currentDb.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      currentDb.exec("INSERT INTO test VALUES (1, 'current')");
      currentDb.close();

      // Create backup archive
      const backupDir = path.join(tmpDir, 'backup-staging');
      await fs.mkdir(backupDir);
      const backupVault = path.join(backupDir, 'vault');
      await fs.mkdir(backupVault);
      await fs.writeFile(path.join(backupVault, 'restored.md'), '# Restored');
      const backupDb = new Database(path.join(backupDir, 'kalepin.sqlite'));
      backupDb.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      backupDb.exec("INSERT INTO test VALUES (1, 'restored')");
      backupDb.close();

      const archivePath = path.join(tmpDir, 'test-backup.tar.gz');
      await tar.create({ gzip: true, file: archivePath, cwd: backupDir }, ['vault', 'kalepin.sqlite']);

      const origVault = process.env.VAULT_PATH;
      const origDb = process.env.DB_PATH;
      process.env.VAULT_PATH = vaultPath;
      process.env.DB_PATH = dbPath;

      try {
        const service = new ArchiveService();
        await service.restoreFromArchive(archivePath);

        // Vault replaced
        const files = await fs.readdir(vaultPath);
        assert.ok(files.includes('restored.md'));
        assert.ok(!files.includes('current.md'));
        const content = await fs.readFile(path.join(vaultPath, 'restored.md'), 'utf8');
        assert.equal(content, '# Restored');

        // DB replaced
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

  describe('archive validation (e2e-level)', () => {
    it('createArchive produces a gzip content type archive', async () => {
      const vaultPath = path.join(tmpDir, 'vault');
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(path.join(vaultPath, 'note.md'), '# Test');

      const dbPath = path.join(tmpDir, 'test.sqlite');
      const db = new Database(dbPath);
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
      db.close();

      const origVault = process.env.VAULT_PATH;
      const origDb = process.env.DB_PATH;
      process.env.VAULT_PATH = vaultPath;
      process.env.DB_PATH = dbPath;

      try {
        const service = new ArchiveService();
        const { archivePath, tmpDir: archiveTmpDir } = await service.createArchive();

        // Verify it's a valid gzip file (magic bytes: 1f 8b)
        const buf = Buffer.alloc(2);
        const fd = await fs.open(archivePath, 'r');
        await fd.read(buf, 0, 2, 0);
        await fd.close();
        assert.equal(buf[0], 0x1f);
        assert.equal(buf[1], 0x8b);

        await fs.rm(archiveTmpDir, { recursive: true, force: true });
      } finally {
        if (origVault !== undefined) process.env.VAULT_PATH = origVault;
        else delete process.env.VAULT_PATH;
        if (origDb !== undefined) process.env.DB_PATH = origDb;
        else delete process.env.DB_PATH;
      }
    });

    it('restoreFromArchive rejects archive without vault/', async () => {
      const vaultPath = path.join(tmpDir, 'vault');
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(path.join(vaultPath, 'note.md'), '# Test');

      const dbPath = path.join(tmpDir, 'kalepin.sqlite');
      const db = new Database(dbPath);
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
      db.close();

      // Create invalid archive (no vault/)
      const badDir = path.join(tmpDir, 'bad-archive');
      await fs.mkdir(badDir);
      await fs.writeFile(path.join(badDir, 'kalepin.sqlite'), 'fake');
      const badArchivePath = path.join(tmpDir, 'bad.tar.gz');
      await tar.create({ gzip: true, file: badArchivePath, cwd: badDir }, ['kalepin.sqlite']);

      const origVault = process.env.VAULT_PATH;
      const origDb = process.env.DB_PATH;
      process.env.VAULT_PATH = vaultPath;
      process.env.DB_PATH = dbPath;

      try {
        const service = new ArchiveService();
        await assert.rejects(
          () => service.restoreFromArchive(badArchivePath),
          (err: Error) => {
            // Should fail because there's no vault/ in the archive
            return true;
          },
        );
      } finally {
        if (origVault !== undefined) process.env.VAULT_PATH = origVault;
        else delete process.env.VAULT_PATH;
        if (origDb !== undefined) process.env.DB_PATH = origDb;
        else delete process.env.DB_PATH;
      }
    });
  });
});
