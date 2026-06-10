import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { FileEntry, FileChangeEvent } from '@kalepin/shared';
import type { StorageAdapter } from '../storage/storage-adapter.interface';
import { EncryptingStorageAdapter } from '../storage/encrypting-fs.adapter';
import { MemoryKEKSource } from '../crypto/kek-source';
import { hasEnvelopeMagic } from '../crypto/envelope';
import { EncryptionPredicates } from '../crypto/encryption-predicates';
import { ArchiveLike, appendVirtualTreeToArchive } from './download-zip';

class InMemoryAdapter implements StorageAdapter {
  files = new Map<string, Buffer>();
  // Tree shape: directories implied by paths (segments separated by '/').

  async read(p: string): Promise<string> {
    return (await this.readBytes(p)).toString('utf-8');
  }
  async write(p: string, c: string): Promise<void> {
    return this.writeBytes(p, Buffer.from(c, 'utf-8'));
  }
  async readBytes(p: string): Promise<Buffer> {
    const v = this.files.get(p);
    if (!v) throw new Error(`ENOENT: ${p}`);
    return v;
  }
  async writeBytes(p: string, c: Buffer): Promise<void> {
    this.files.set(p, Buffer.from(c));
  }
  async writeBytesAtomic(p: string, c: Buffer): Promise<void> {
    this.files.set(p, Buffer.from(c));
  }
  async delete(p: string): Promise<void> {
    this.files.delete(p);
  }
  async move(s: string, d: string): Promise<void> {
    const v = this.files.get(s);
    if (!v) throw new Error(`ENOENT: ${s}`);
    this.files.set(d, v);
    this.files.delete(s);
  }
  async list(dir: string): Promise<FileEntry[]> {
    const prefix = dir === '' ? '' : `${dir}/`;
    const seen = new Map<string, FileEntry>();
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      if (dir !== '' && p === dir) continue;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        seen.set(p, { name: rest, path: p, type: 'file' });
      } else {
        const childDirName = rest.slice(0, slash);
        const childDirPath = `${prefix}${childDirName}`;
        if (!seen.has(childDirPath)) {
          seen.set(childDirPath, { name: childDirName, path: childDirPath, type: 'directory' });
        }
      }
    }
    return [...seen.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  async exists(p: string): Promise<boolean> {
    if (this.files.has(p)) return true;
    for (const k of this.files.keys()) if (k.startsWith(`${p}/`)) return true;
    return false;
  }
  async stat(_p: string): Promise<{ mtime: Date }> {
    return { mtime: new Date(0) };
  }
  watch(_cb: (e: FileChangeEvent) => void): void {}
}

class AlwaysEncrypted implements EncryptionPredicates {
  isEncryptedAtRest(): boolean { return true; }
  isE2EEncrypted(): boolean { return false; }
  shouldIndexPlaintext(): boolean { return true; }
  canCollab(): boolean { return true; }
  commentBodiesEncrypted(): boolean { return false; }
  shareLinkMintable(): boolean { return true; }
}

class CapturingArchive implements ArchiveLike {
  entries: { name: string; data: Buffer }[] = [];
  append(data: Buffer | string, opts: { name: string }): void {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    this.entries.push({ name: opts.name, data: buf });
  }
}

let inner: InMemoryAdapter;
let kek: MemoryKEKSource;
let storage: EncryptingStorageAdapter;

beforeEach(() => {
  inner = new InMemoryAdapter();
  kek = new MemoryKEKSource(crypto.randomBytes(32));
  storage = new EncryptingStorageAdapter(inner, kek, new AlwaysEncrypted());
});

describe('appendVirtualTreeToArchive — download-zip plaintext output', () => {
  it('returns plaintext markdown for encrypted notes (envelope on disk, plaintext in tar)', async () => {
    await storage.write('_users/alice/diary.md', '# diary');
    await storage.write('_users/alice/sub/note.md', '## subnote');
    // Sanity: the underlying inner has envelopes
    assert.equal(hasEnvelopeMagic(inner.files.get('_users/alice/diary.md')!), true);

    const archive = new CapturingArchive();
    await appendVirtualTreeToArchive(archive, storage, '_users/alice');

    const byName = new Map(archive.entries.map((e) => [e.name, e.data]));
    assert.equal(byName.get('_users/alice/diary.md')?.toString('utf-8'), '# diary');
    assert.equal(byName.get('_users/alice/sub/note.md')?.toString('utf-8'), '## subnote');
    assert.equal(archive.entries.length, 2);
  });

  it('returns binary attachment bytes byte-identical despite envelope on disk', async () => {
    const png = crypto.randomBytes(4096);
    await storage.writeBytes('_users/alice/_attachments/img.png', png);
    assert.equal(hasEnvelopeMagic(inner.files.get('_users/alice/_attachments/img.png')!), true);

    const archive = new CapturingArchive();
    await appendVirtualTreeToArchive(archive, storage, '_users/alice');

    const entry = archive.entries.find((e) => e.name.endsWith('img.png'));
    assert.ok(entry, 'attachment entry missing');
    assert.deepEqual(entry!.data, png);
  });

  it('skipPersonalAtRoot drops _users/* when walking shared root', async () => {
    await storage.write('Notes/team.md', '# team');
    await storage.write('_users/alice/diary.md', '# diary');
    const archive = new CapturingArchive();
    await appendVirtualTreeToArchive(archive, storage, '', { skipPersonalAtRoot: true });
    const names = archive.entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['Notes/team.md']);
  });
});
