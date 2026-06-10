import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';
import * as Database from 'better-sqlite3';
import { ArchiveService } from './archive.service';

describe('ArchiveService — both-roots coverage', () => {
  let tmpDir: string;
  let origVault: string | undefined;
  let origPersonal: string | undefined;
  let origDb: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-personal-'));
    origVault = process.env.VAULT_PATH;
    origPersonal = process.env.PERSONAL_PATH;
    origDb = process.env.DB_PATH;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (origVault !== undefined) process.env.VAULT_PATH = origVault;
    else delete process.env.VAULT_PATH;
    if (origPersonal !== undefined) process.env.PERSONAL_PATH = origPersonal;
    else delete process.env.PERSONAL_PATH;
    if (origDb !== undefined) process.env.DB_PATH = origDb;
    else delete process.env.DB_PATH;
  });

  it('createArchive includes personal/ when PERSONAL_PATH is set', async () => {
    const vaultPath = path.join(tmpDir, 'vault');
    const personalPath = path.join(tmpDir, 'personal');
    await fs.mkdir(vaultPath, { recursive: true });
    await fs.mkdir(path.join(personalPath, 'alice@example.com'), { recursive: true });
    await fs.writeFile(path.join(vaultPath, 'shared.md'), '# Shared');
    await fs.writeFile(path.join(personalPath, 'alice@example.com', 'diary.md'), '# Alice diary');

    const dbPath = path.join(tmpDir, 'test.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    db.close();

    process.env.VAULT_PATH = vaultPath;
    process.env.PERSONAL_PATH = personalPath;
    process.env.DB_PATH = dbPath;

    const service = new ArchiveService();
    const { archivePath, tmpDir: archiveTmpDir } = await service.createArchive();

    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir);
    await tar.extract({ file: archivePath, cwd: extractDir });

    const sharedContent = await fs.readFile(
      path.join(extractDir, 'vault', 'shared.md'),
      'utf-8',
    );
    assert.equal(sharedContent, '# Shared');

    const aliceContent = await fs.readFile(
      path.join(extractDir, 'personal', 'alice@example.com', 'diary.md'),
      'utf-8',
    );
    assert.equal(aliceContent, '# Alice diary');

    await fs.rm(archiveTmpDir, { recursive: true, force: true });
  });

  it('createArchive omits personal/ when PERSONAL_PATH is unset (backward compat)', async () => {
    const vaultPath = path.join(tmpDir, 'vault');
    await fs.mkdir(vaultPath, { recursive: true });
    await fs.writeFile(path.join(vaultPath, 'shared.md'), '# Shared');

    const dbPath = path.join(tmpDir, 'test.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    db.close();

    process.env.VAULT_PATH = vaultPath;
    delete process.env.PERSONAL_PATH;
    process.env.DB_PATH = dbPath;

    const service = new ArchiveService();
    const { archivePath, tmpDir: archiveTmpDir } = await service.createArchive();

    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir);
    await tar.extract({ file: archivePath, cwd: extractDir });

    const entries = await fs.readdir(extractDir);
    assert.ok(entries.includes('vault'));
    assert.ok(!entries.includes('personal'));

    await fs.rm(archiveTmpDir, { recursive: true, force: true });
  });

  it('round-trip: createArchive → restoreFromArchive preserves both roots byte-identical', async () => {
    // Source state
    const vaultPath = path.join(tmpDir, 'vault');
    const personalPath = path.join(tmpDir, 'personal');
    await fs.mkdir(vaultPath, { recursive: true });
    await fs.mkdir(path.join(personalPath, 'alice@example.com'), { recursive: true });
    await fs.mkdir(path.join(personalPath, 'bob@example.com'), { recursive: true });
    const sharedNote = '# Shared note\n\ncontent ABC';
    const aliceNote = '# Alice diary\n\nbody DEF';
    const bobNote = '# Bob scratch';
    await fs.writeFile(path.join(vaultPath, 'shared.md'), sharedNote);
    await fs.writeFile(path.join(personalPath, 'alice@example.com', 'diary.md'), aliceNote);
    await fs.writeFile(path.join(personalPath, 'bob@example.com', 'scratch.md'), bobNote);

    const dbPath = path.join(tmpDir, 'test.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO notes VALUES (1, 'before-roundtrip')");
    db.close();

    process.env.VAULT_PATH = vaultPath;
    process.env.PERSONAL_PATH = personalPath;
    process.env.DB_PATH = dbPath;

    const service = new ArchiveService();
    const { archivePath, tmpDir: archiveTmpDir } = await service.createArchive();

    // Tamper: delete some files to confirm restore brings them back
    await fs.rm(path.join(personalPath, 'alice@example.com', 'diary.md'));
    await fs.writeFile(path.join(vaultPath, 'shared.md'), '# tampered');

    await service.restoreFromArchive(archivePath);

    const sharedAfter = await fs.readFile(path.join(vaultPath, 'shared.md'), 'utf-8');
    assert.equal(sharedAfter, sharedNote);

    const aliceAfter = await fs.readFile(
      path.join(personalPath, 'alice@example.com', 'diary.md'),
      'utf-8',
    );
    assert.equal(aliceAfter, aliceNote);

    const bobAfter = await fs.readFile(
      path.join(personalPath, 'bob@example.com', 'scratch.md'),
      'utf-8',
    );
    assert.equal(bobAfter, bobNote);

    await fs.rm(archiveTmpDir, { recursive: true, force: true });
  });
});
