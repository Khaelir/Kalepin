import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { FileEntry, FileChangeEvent } from '@kalepin/shared';
import { StorageAdapter } from './storage-adapter.interface';
import { EncryptingStorageAdapter } from './encrypting-fs.adapter';
import { MemoryKEKSource } from '../crypto/kek-source';
import { hasEnvelopeMagic, encrypt } from '../crypto/envelope';
import { EncryptionPredicates } from '../crypto/encryption-predicates';

class InMemoryAdapter implements StorageAdapter {
  files = new Map<string, Buffer>();

  async read(p: string): Promise<string> {
    return (await this.readBytes(p)).toString('utf-8');
  }
  async write(p: string, content: string): Promise<void> {
    return this.writeBytes(p, Buffer.from(content, 'utf-8'));
  }
  async readBytes(p: string): Promise<Buffer> {
    const v = this.files.get(p);
    if (!v) throw new Error(`ENOENT: ${p}`);
    return v;
  }
  async writeBytes(p: string, content: Buffer): Promise<void> {
    this.files.set(p, Buffer.from(content));
  }
  async writeBytesAtomic(p: string, content: Buffer): Promise<void> {
    this.files.set(p, Buffer.from(content));
  }
  async delete(p: string): Promise<void> {
    this.files.delete(p);
  }
  async move(src: string, dest: string): Promise<void> {
    const v = this.files.get(src);
    if (!v) throw new Error(`ENOENT: ${src}`);
    this.files.set(dest, v);
    this.files.delete(src);
  }
  async list(_dir: string): Promise<FileEntry[]> {
    return [];
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async stat(_p: string): Promise<{ mtime: Date }> {
    return { mtime: new Date(0) };
  }
  watch(_cb: (event: FileChangeEvent) => void): void {}
}

class TestPredicates implements EncryptionPredicates {
  encryptedPaths = new Set<string>();
  encryptedZones = { personal: false, shared: false };
  e2ePaths = new Set<string>();

  isEncryptedAtRest(path: string): boolean {
    if (this.isE2EEncrypted(path)) return true;
    if (this.encryptedPaths.has(path)) return true;
    if (path.startsWith('_users/')) return this.encryptedZones.personal;
    return this.encryptedZones.shared;
  }
  isE2EEncrypted(path: string): boolean { return this.e2ePaths.has(path); }
  shouldIndexPlaintext(path: string): boolean { return !this.isE2EEncrypted(path); }
  canCollab(path: string): boolean { return !this.isE2EEncrypted(path); }
  commentBodiesEncrypted(path: string): boolean { return this.isE2EEncrypted(path); }
  shareLinkMintable(path: string): boolean { return !this.isE2EEncrypted(path); }
}

let inner: InMemoryAdapter;
let kek: MemoryKEKSource;
let predicates: TestPredicates;
let adapter: EncryptingStorageAdapter;

beforeEach(() => {
  inner = new InMemoryAdapter();
  kek = new MemoryKEKSource(crypto.randomBytes(32));
  predicates = new TestPredicates();
  adapter = new EncryptingStorageAdapter(inner, kek, predicates);
});

describe('EncryptingStorageAdapter — write paths', () => {
  it('writes plaintext to disk for shared zone (default disabled)', async () => {
    await adapter.write('Notes/foo.md', '# hi');
    const onDisk = inner.files.get('Notes/foo.md')!;
    assert.equal(onDisk.toString('utf-8'), '# hi');
    assert.equal(hasEnvelopeMagic(onDisk), false);
  });

  it('writes envelope to disk for personal zone (default enabled)', async () => {
    predicates.encryptedZones.personal = true;
    await adapter.write('_users/alice/diary.md', '# secret');
    const onDisk = inner.files.get('_users/alice/diary.md')!;
    assert.equal(hasEnvelopeMagic(onDisk), true);
    // Plaintext is not present anywhere in the bytes
    assert.equal(onDisk.includes(Buffer.from('# secret')), false);
  });

  it('round-trips through write→read on encrypted path', async () => {
    predicates.encryptedZones.personal = true;
    const src = '_users/alice/diary.md';
    await adapter.write(src, '# secret');
    const out = await adapter.read(src);
    assert.equal(out, '# secret');
  });

  it('writes binary attachment as envelope under encrypted zone', async () => {
    predicates.encryptedZones.personal = true;
    const path = '_users/alice/_attachments/img.png';
    const bin = crypto.randomBytes(2048);
    await adapter.writeBytes(path, bin);
    const onDisk = inner.files.get(path)!;
    assert.equal(hasEnvelopeMagic(onDisk), true);
    const out = await adapter.readBytes(path);
    assert.deepEqual(out, bin);
  });
});

describe('EncryptingStorageAdapter — read paths', () => {
  it('passes through plaintext on disk even in an encrypted zone (mid-sweep tolerance)', async () => {
    predicates.encryptedZones.personal = true;
    inner.files.set('_users/alice/legacy.md', Buffer.from('# legacy plaintext', 'utf-8'));
    const out = await adapter.read('_users/alice/legacy.md');
    assert.equal(out, '# legacy plaintext');
  });

  it('decrypts envelope on disk regardless of current zone state', async () => {
    // Write envelope manually
    const env = await encrypt(Buffer.from('hi'), '_users/alice/foo.md', kek, 'personal');
    inner.files.set('_users/alice/foo.md', env);
    // Zone is currently disabled, but read still detects magic and decrypts
    predicates.encryptedZones.personal = false;
    const out = await adapter.read('_users/alice/foo.md');
    assert.equal(out, 'hi');
  });

  it('throws clear error for envelope written with a different KEK', async () => {
    const otherKek = new MemoryKEKSource(crypto.randomBytes(32));
    const env = await encrypt(Buffer.from('hi'), 'Notes/foo.md', otherKek, 'shared');
    inner.files.set('Notes/foo.md', env);
    await assert.rejects(() => adapter.read('Notes/foo.md'), /wrong KEK/);
  });
});

describe('EncryptingStorageAdapter — E2E (ClientKEKSource) passthrough', () => {
  it('writes opaque envelope bytes verbatim and reads them back identical', async () => {
    const path = '_users/alice/_secure/diary.md';
    predicates.e2ePaths.add(path);
    // Construct a synthetic "envelope" — only the magic bytes need to validate.
    const opaque = Buffer.concat([
      Buffer.from([0x4b, 0x45, 0x31, 0x00]), // KE1\0 magic
      crypto.randomBytes(256),
    ]);
    await adapter.writeBytes(path, opaque);
    // On disk, bytes are exactly what the client sent — server didn't re-envelope.
    assert.deepEqual(inner.files.get(path), opaque);
    // Read returns those same bytes (no decrypt attempt).
    const back = await adapter.readBytes(path);
    assert.deepEqual(back, opaque);
  });

  it('rejects writes lacking the envelope magic on E2E paths', async () => {
    const path = '_users/alice/_secure/diary.md';
    predicates.e2ePaths.add(path);
    await assert.rejects(
      () => adapter.writeBytes(path, Buffer.from('not an envelope')),
      /envelope/i,
    );
  });

  it('passes empty-buffer writes through (folder-placeholder sentinels)', async () => {
    // FilesService.createDirectory writes an empty .gitkeep then deletes it
    // to materialize the parent dir on disk. Under _secure/ this must not
    // bounce off the envelope-magic guard or subfolder creation breaks.
    const path = '_users/alice/_secure/Subfolder/.gitkeep';
    predicates.e2ePaths.add(path);
    await adapter.writeBytes(path, Buffer.alloc(0));
    assert.equal(inner.files.get(path)?.length, 0);
  });

  it('reads passthrough does not attempt to decrypt with server KEK', async () => {
    // Place opaque envelope-magic bytes wrapped by an unknown key on disk.
    const path = '_users/alice/_secure/foo.md';
    predicates.e2ePaths.add(path);
    const opaque = Buffer.concat([
      Buffer.from([0x4b, 0x45, 0x31, 0x00]),
      crypto.randomBytes(128),
    ]);
    inner.files.set(path, opaque);
    // Should not throw "wrong KEK" — just pass through.
    const back = await adapter.readBytes(path);
    assert.deepEqual(back, opaque);
  });

  it('rejects move() that crosses an E2E boundary', async () => {
    predicates.e2ePaths.add('_users/alice/_secure/diary.md');
    await assert.rejects(
      () => adapter.move('_users/alice/notes/foo.md', '_users/alice/_secure/diary.md'),
      /not supported/i,
    );
    await assert.rejects(
      () => adapter.move('_users/alice/_secure/diary.md', '_users/alice/notes/foo.md'),
      /not supported/i,
    );
  });
});

describe('EncryptingStorageAdapter — move', () => {
  it('passthrough move when both endpoints are plaintext', async () => {
    await adapter.write('Notes/old.md', 'body');
    await adapter.move('Notes/old.md', 'Notes/new.md');
    assert.equal(await adapter.read('Notes/new.md'), 'body');
    assert.equal(inner.files.has('Notes/old.md'), false);
    assert.equal(hasEnvelopeMagic(inner.files.get('Notes/new.md')!), false);
  });

  it('rebinds AAD when moving an encrypted file', async () => {
    predicates.encryptedZones.personal = true;
    await adapter.write('_users/alice/old.md', 'body');
    await adapter.move('_users/alice/old.md', '_users/alice/new.md');
    // new file decrypts under new path
    assert.equal(await adapter.read('_users/alice/new.md'), 'body');
    // old file gone
    assert.equal(inner.files.has('_users/alice/old.md'), false);
    // new file is an envelope
    assert.equal(hasEnvelopeMagic(inner.files.get('_users/alice/new.md')!), true);
  });

  it('cross-zone move encrypts at destination if dest zone is enabled', async () => {
    predicates.encryptedZones.shared = true;
    await adapter.write('_users/alice/foo.md', 'body'); // plaintext (personal disabled)
    await adapter.move('_users/alice/foo.md', 'Notes/foo.md'); // dest is encrypted shared
    assert.equal(await adapter.read('Notes/foo.md'), 'body');
    assert.equal(hasEnvelopeMagic(inner.files.get('Notes/foo.md')!), true);
  });
});
