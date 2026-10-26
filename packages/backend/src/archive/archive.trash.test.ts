import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as tar from 'tar';
import * as Database from 'better-sqlite3';
import { ArchiveService } from './archive.service';

// Admin backups must carry the trash folders together with `trash_items`, so
// a restored backup can still restore trashed notes.

describe('ArchiveService — trash', () => {
  let tmpDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-trash-'));
    for (const k of ['VAULT_PATH', 'PERSONAL_PATH', 'DB_PATH']) saved[k] = process.env[k];
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('includes shared and personal .trash folders in the backup', async () => {
    const vault = path.join(tmpDir, 'vault');
    const personal = path.join(tmpDir, 'personal');
    await fs.mkdir(path.join(vault, '.trash/abc'), { recursive: true });
    await fs.writeFile(path.join(vault, '.trash/abc/Plan.md'), 'shared trashed');
    await fs.mkdir(path.join(personal, 'alice@x.com/.trash/def'), { recursive: true });
    await fs.writeFile(path.join(personal, 'alice@x.com/.trash/def/Mine.md'), 'personal trashed');

    const dbPath = path.join(tmpDir, 'k.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE trash_items (id TEXT PRIMARY KEY)');
    db.exec("INSERT INTO trash_items VALUES ('abc')");
    db.close();

    process.env.VAULT_PATH = vault;
    process.env.PERSONAL_PATH = personal;
    process.env.DB_PATH = dbPath;

    const { archivePath, tmpDir: archiveTmp } = await new ArchiveService().createArchive();
    const out = path.join(tmpDir, 'out');
    await fs.mkdir(out);
    await tar.extract({ file: archivePath, cwd: out });

    assert.equal(await fs.readFile(path.join(out, 'vault/.trash/abc/Plan.md'), 'utf8'), 'shared trashed');
    assert.equal(
      await fs.readFile(path.join(out, 'personal/alice@x.com/.trash/def/Mine.md'), 'utf8'),
      'personal trashed',
    );
    const restored = new Database(path.join(out, 'kalepin.sqlite'), { readonly: true });
    const row = restored.prepare('SELECT id FROM trash_items').get() as { id: string };
    restored.close();
    assert.equal(row.id, 'abc');
    await fs.rm(archiveTmp, { recursive: true, force: true });
  });
});
