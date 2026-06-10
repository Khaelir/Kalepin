import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { FileEntry, FileChangeEvent } from '@kalepin/shared';
import { User, MagicLinkToken, ApiKey, NoteChange } from '../entities';
import { StorageAdapter } from '../storage/storage-adapter.interface';
import { SecureVaultService } from './secure-vault.service';

class InMemoryAdapter implements StorageAdapter {
  files = new Map<string, Buffer>();
  dirs = new Set<string>();
  async read(p: string): Promise<string> { return (await this.readBytes(p)).toString('utf-8'); }
  async write(p: string, content: string): Promise<void> { return this.writeBytes(p, Buffer.from(content, 'utf-8')); }
  async readBytes(p: string): Promise<Buffer> {
    const v = this.files.get(p);
    if (!v) throw new Error(`ENOENT: ${p}`);
    return v;
  }
  async writeBytes(p: string, content: Buffer): Promise<void> { this.files.set(p, Buffer.from(content)); }
  async writeBytesAtomic(p: string, content: Buffer): Promise<void> { this.files.set(p, Buffer.from(content)); }
  async delete(p: string): Promise<void> {
    // Recursive delete: matches LocalFSAdapter behavior for directories.
    let removed = false;
    if (this.files.delete(p)) removed = true;
    for (const k of [...this.files.keys()]) {
      if (k.startsWith(p + '/')) {
        this.files.delete(k);
        removed = true;
      }
    }
    this.dirs.delete(p);
    if (!removed && !this.dirs.has(p)) {
      // tolerate idempotent delete
    }
  }
  async move(src: string, dest: string): Promise<void> {
    if (this.files.has(src)) {
      this.files.set(dest, this.files.get(src)!);
      this.files.delete(src);
      return;
    }
    // Directory rename: relocate every file under the prefix.
    const entries = [...this.files.keys()].filter((k) => k.startsWith(src + '/'));
    if (entries.length === 0 && !this.dirs.has(src)) throw new Error(`ENOENT: ${src}`);
    for (const k of entries) {
      const newKey = dest + k.slice(src.length);
      this.files.set(newKey, this.files.get(k)!);
      this.files.delete(k);
    }
    this.dirs.delete(src);
    this.dirs.add(dest);
  }
  async list(dir: string): Promise<FileEntry[]> {
    const prefix = dir ? `${dir}/` : '';
    const direct = new Set<string>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) direct.add(rest);
    }
    const out: FileEntry[] = [];
    for (const name of direct) {
      out.push({ name, path: prefix + name, type: 'file' });
    }
    return out;
  }
  async exists(p: string): Promise<boolean> {
    if (this.files.has(p)) return true;
    if (this.dirs.has(p)) return true;
    for (const k of this.files.keys()) {
      if (k.startsWith(p + '/')) return true;
    }
    return false;
  }
  watch(_cb: (event: FileChangeEvent) => void): void {}
}

let ds: DataSource;
let storage: InMemoryAdapter;
let svc: SecureVaultService;
let userId: number;

const ALICE_EMAIL = 'alice@example.com';
const SECURE = '_users/alice@example.com/_secure';

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret-vault';

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [User, MagicLinkToken, ApiKey, NoteChange],
    synchronize: true,
  });
  await ds.initialize();

  storage = new InMemoryAdapter();
  svc = new SecureVaultService(
    ds.getRepository(User),
    ds.getRepository(NoteChange),
    storage as unknown as StorageAdapter,
    ds,
  );

  const user = await ds.getRepository(User).save({
    email: ALICE_EMAIL,
    completedTours: [],
  } as Partial<User> as any);
  userId = user.id;
});

afterEach(async () => {
  await ds.destroy();
});

describe('SecureVaultService — putVaultMeta', () => {
  it('stores opaque blobs and stamps vault_setup_at', async () => {
    const passphraseKek = crypto.randomBytes(40);
    const salt = crypto.randomBytes(16);
    const out = await svc.putVaultMeta(userId, {
      passphrase_wrapped_kek: passphraseKek.toString('base64'),
      passphrase_salt: salt.toString('base64'),
    });
    assert.equal(out.ok, true);
    assert.ok(out.vault_setup_at > 0);

    const meta = await svc.getVaultMeta(userId);
    assert.equal(meta.passphrase_wrapped_kek, passphraseKek.toString('base64'));
    assert.equal(meta.passphrase_salt, salt.toString('base64'));
    assert.equal(meta.recovery_wrapped_kek, null);
  });

  it('rejects a wrong-length salt', async () => {
    await assert.rejects(
      () => svc.putVaultMeta(userId, {
        passphrase_wrapped_kek: Buffer.from('x').toString('base64'),
        passphrase_salt: Buffer.alloc(8).toString('base64'),
      }),
      /16 bytes/,
    );
  });

  it('updates without changing vault_setup_at on a passphrase rotation', async () => {
    const salt1 = crypto.randomBytes(16);
    const salt2 = crypto.randomBytes(16);
    const a = await svc.putVaultMeta(userId, {
      passphrase_wrapped_kek: Buffer.from('one').toString('base64'),
      passphrase_salt: salt1.toString('base64'),
    });
    const b = await svc.putVaultMeta(userId, {
      passphrase_wrapped_kek: Buffer.from('two').toString('base64'),
      passphrase_salt: salt2.toString('base64'),
    });
    assert.equal(a.vault_setup_at, b.vault_setup_at);
  });

  it('preserves recovery blob when the rotation body omits recovery fields', async () => {
    await svc.putVaultMeta(userId, {
      passphrase_wrapped_kek: Buffer.from('p').toString('base64'),
      passphrase_salt: crypto.randomBytes(16).toString('base64'),
      recovery_wrapped_kek: Buffer.from('r').toString('base64'),
      recovery_salt: crypto.randomBytes(16).toString('base64'),
    });
    await svc.putVaultMeta(userId, {
      passphrase_wrapped_kek: Buffer.from('p2').toString('base64'),
      passphrase_salt: crypto.randomBytes(16).toString('base64'),
    });
    const meta = await svc.getVaultMeta(userId);
    assert.ok(meta.recovery_wrapped_kek, 'recovery_wrapped_kek must survive a passphrase-only rotation');
  });
});

describe('SecureVaultService — resetVault', () => {
  beforeEach(async () => {
    await svc.putVaultMeta(userId, {
      passphrase_wrapped_kek: Buffer.from('pwk').toString('base64'),
      passphrase_salt: crypto.randomBytes(16).toString('base64'),
      recovery_wrapped_kek: Buffer.from('rwk').toString('base64'),
      recovery_salt: crypto.randomBytes(16).toString('base64'),
    });
    storage.files.set(`${SECURE}/journal.md`, Buffer.from([0x4b, 0x45, 0x31, 0x00]));
    storage.files.set(`${SECURE}/notes/passwords.md`, Buffer.from([0x4b, 0x45, 0x31, 0x00]));
  });

  it('rejects a confirm_email mismatch (case-sensitive on the local part)', async () => {
    await assert.rejects(
      () => svc.resetVault(userId, 'bob@example.com'),
      /confirm_email/i,
    );
  });

  it('canonicalizes by lowercasing — ALICE@example.com matches alice@example.com', async () => {
    const out = await svc.resetVault(userId, 'ALICE@EXAMPLE.COM');
    assert.ok(out.tombstone_path.includes('_secure.tombstone-'));
  });

  it('clears wrapped-KEKs, sets tombstone state, and renames the directory', async () => {
    const before = await svc.getVaultMeta(userId);
    assert.ok(before.passphrase_wrapped_kek);
    const out = await svc.resetVault(userId, ALICE_EMAIL);
    const after = await svc.getVaultMeta(userId);

    assert.equal(after.passphrase_wrapped_kek, null);
    assert.equal(after.recovery_wrapped_kek, null);
    assert.equal(after.passphrase_salt, null);
    assert.equal(after.recovery_salt, null);
    assert.ok(after.vault_tombstone_at);
    assert.equal(await storage.exists(SECURE), false);
    assert.equal(await storage.exists(out.tombstone_path), true);
  });

  it('records a note_change audit row with vault.reset action', async () => {
    await svc.resetVault(userId, ALICE_EMAIL);
    const rows = await ds.getRepository(NoteChange)
      .createQueryBuilder('c')
      .where('c.action = :action', { action: 'vault.reset' })
      .getMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metadataOnly, 1);
    assert.equal(rows[0].path, SECURE);
    const payload = JSON.parse(rows[0].diff!);
    assert.equal(payload.user_id, userId);
    assert.ok(payload.tombstone_path.includes('_secure.tombstone-'));
  });
});

describe('SecureVaultService — undoReset', () => {
  let resetResult: { tombstone_path: string; expires_at: number; files_count: number };
  let originalPassphraseB64: string;

  beforeEach(async () => {
    originalPassphraseB64 = Buffer.from('original-pwk').toString('base64');
    await svc.putVaultMeta(userId, {
      passphrase_wrapped_kek: originalPassphraseB64,
      passphrase_salt: crypto.randomBytes(16).toString('base64'),
    });
    storage.files.set(`${SECURE}/foo.md`, Buffer.from([0x4b, 0x45, 0x31, 0x00]));
    resetResult = await svc.resetVault(userId, ALICE_EMAIL);
  });

  it('round-trips: tombstone restored, wrapped KEKs back, vault unlockable again', async () => {
    const user = await ds.getRepository(User).findOneByOrFail({ id: userId });
    const tombstoneAt = user.vaultTombstoneAt!;
    const expiresAt = tombstoneAt + 24 * 60 * 60 * 1000;
    const token = (svc as any).signUndoToken(userId, tombstoneAt, expiresAt);

    await svc.undoReset(token);

    const meta = await svc.getVaultMeta(userId);
    assert.equal(meta.passphrase_wrapped_kek, originalPassphraseB64);
    assert.equal(meta.vault_tombstone_at, null);
    assert.equal(await storage.exists(SECURE), true);
    assert.equal(await storage.exists(resetResult.tombstone_path), false);
  });

  it('rejects an undo with a forged token', async () => {
    await assert.rejects(
      () => svc.undoReset('1.2.3.invalid'),
      /invalid/i,
    );
  });

  it('rejects an undo whose token has expired', async () => {
    const user = await ds.getRepository(User).findOneByOrFail({ id: userId });
    const tombstoneAt = user.vaultTombstoneAt!;
    const expired = Date.now() - 1000;
    const token = (svc as any).signUndoToken(userId, tombstoneAt, expired);
    await assert.rejects(() => svc.undoReset(token), /expired/i);
  });

  it('rejects undo after the tombstone has been finalized', async () => {
    const user = await ds.getRepository(User).findOneByOrFail({ id: userId });
    const tombstoneAt = user.vaultTombstoneAt!;
    const expiresAt = tombstoneAt + 24 * 60 * 60 * 1000;
    // Simulate sweep: clear tombstone state, delete tombstone directory.
    await svc.runTombstoneSweep(tombstoneAt + 25 * 60 * 60 * 1000);
    const token = (svc as any).signUndoToken(userId, tombstoneAt, expiresAt);
    await assert.rejects(() => svc.undoReset(token), /tombstone state/i);
  });
});

describe('SecureVaultService — runTombstoneSweep', () => {
  it('finalizes tombstones older than 24h and emits vault.reset.finalized', async () => {
    await svc.putVaultMeta(userId, {
      passphrase_wrapped_kek: Buffer.from('pwk').toString('base64'),
      passphrase_salt: crypto.randomBytes(16).toString('base64'),
    });
    storage.files.set(`${SECURE}/x.md`, Buffer.from([0x4b, 0x45, 0x31, 0x00]));
    const reset = await svc.resetVault(userId, ALICE_EMAIL);

    // First sweep: too soon → no-op.
    let res = await svc.runTombstoneSweep(reset.expires_at - 1000);
    assert.equal(res.finalized, 0);
    assert.equal(await storage.exists(reset.tombstone_path), true);

    // Second sweep: past the grace window.
    res = await svc.runTombstoneSweep(reset.expires_at + 1000);
    assert.equal(res.finalized, 1);
    assert.equal(await storage.exists(reset.tombstone_path), false);

    const finalizedRows = await ds.getRepository(NoteChange)
      .createQueryBuilder('c')
      .where('c.action = :a', { a: 'vault.reset.finalized' })
      .getMany();
    assert.equal(finalizedRows.length, 1);
  });

  it('is idempotent — re-running on a fresh user is a no-op', async () => {
    const r = await svc.runTombstoneSweep(Date.now());
    assert.equal(r.finalized, 0);
    assert.equal(r.failed, 0);
  });
});
