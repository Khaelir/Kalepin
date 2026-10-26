import { BadRequestException } from '@nestjs/common';
import { FileEntry, FileChangeEvent } from '@kalepin/shared';
import { StorageAdapter } from './storage-adapter.interface';
import {
  encrypt,
  decrypt,
  hasEnvelopeMagic,
  EnvelopeKind,
} from '../crypto/envelope';
import { ClientKEKSource, KEKSource } from '../crypto/kek-source';
import { EncryptionPredicates } from '../crypto/encryption-predicates';
import { zoneFor } from '../encryption/zone-for';

/**
 * Wraps an inner StorageAdapter with at-rest envelope encryption.
 *
 * Reads auto-detect: if the first four bytes are the envelope magic, the file
 * is decrypted; otherwise the bytes pass through verbatim. This makes the
 * runtime encrypt/decrypt sweep safe — files mid-state are still readable.
 *
 * Writes consult `predicates.isEncryptedAtRest(path)` and either pass through
 * to `inner.writeBytes` or encrypt and atomically rename via
 * `inner.writeBytesAtomic`.
 *
 * `delete`, `list`, `stat`, `exists`, `watch`, `watchPersonal` are passthrough.
 * `move` re-encrypts when either endpoint is in an encrypted state, so the AAD
 * (which binds the path) stays valid for the destination.
 */
export class EncryptingStorageAdapter implements StorageAdapter {
  private readonly clientKek = new ClientKEKSource();

  constructor(
    private readonly inner: StorageAdapter,
    private readonly kek: KEKSource,
    private readonly predicates: EncryptionPredicates,
  ) {
    if (!inner.readBytes || !inner.writeBytes || !inner.writeBytesAtomic) {
      throw new Error(
        'EncryptingStorageAdapter requires an inner adapter with readBytes/writeBytes/writeBytesAtomic',
      );
    }
  }

  /**
   * Resolve the KEK source for a path. Returns `ClientKEKSource` for end-to-end
   * encrypted paths (server cannot wrap/unwrap), the configured server KEK
   * otherwise.
   */
  kekSourceFor(virtualPath: string): KEKSource {
    return this.predicates.isE2EEncrypted(virtualPath) ? this.clientKek : this.kek;
  }

  async read(virtualPath: string): Promise<string> {
    const buf = await this.readBytes(virtualPath);
    return buf.toString('utf-8');
  }

  async readBytes(virtualPath: string): Promise<Buffer> {
    const raw = await this.inner.readBytes!(virtualPath);
    if (this.kekSourceFor(virtualPath) instanceof ClientKEKSource) {
      // E2E path — opaque to the server. Always pass through whatever bytes
      // are on disk; the client decrypts.
      return raw;
    }
    if (!hasEnvelopeMagic(raw)) return raw;
    return decrypt(raw, virtualPath, this.kek);
  }

  async write(virtualPath: string, content: string): Promise<void> {
    return this.writeBytes(virtualPath, Buffer.from(content, 'utf-8'));
  }

  async writeBytes(virtualPath: string, content: Buffer): Promise<void> {
    return this.writeBytesInternal(virtualPath, content, 'best-effort');
  }

  async writeBytesAtomic(virtualPath: string, content: Buffer): Promise<void> {
    return this.writeBytesInternal(virtualPath, content, 'best-effort');
  }

  async writeBytesAtomicDurable(virtualPath: string, content: Buffer): Promise<void> {
    return this.writeBytesInternal(virtualPath, content, 'durable');
  }

  private async writeBytesInternal(
    virtualPath: string,
    content: Buffer,
    durability: 'best-effort' | 'durable',
  ): Promise<void> {
    const writeAtomic = (path: string, bytes: Buffer): Promise<void> => {
      if (durability === 'durable' && this.inner.writeBytesAtomicDurable) {
        return this.inner.writeBytesAtomicDurable(path, bytes);
      }
      return this.inner.writeBytesAtomic!(path, bytes);
    };

    if (this.kekSourceFor(virtualPath) instanceof ClientKEKSource) {
      // E2E path — the bytes ARE the envelope. Validate magic, write through.
      // Empty buffers are folder-sentinel writes (FilesService.createDirectory
      // writes an empty `.gitkeep` then deletes it to materialize a parent
      // dir under _secure/). Pass through unencrypted; the bytes are
      // immediately deleted and never read.
      if (content.length === 0) {
        return writeAtomic(virtualPath, content);
      }
      if (!hasEnvelopeMagic(content)) {
        throw new BadRequestException(
          'expected envelope bytes for end-to-end encrypted path',
        );
      }
      return writeAtomic(virtualPath, content);
    }
    if (!this.predicates.isEncryptedAtRest(virtualPath)) {
      // Plaintext path: durable callers still want fsync semantics, so route
      // through the durable atomic variant; best-effort callers can use the
      // inner's non-atomic write to avoid the temp/rename overhead.
      if (durability === 'durable') {
        return writeAtomic(virtualPath, content);
      }
      return this.inner.writeBytes!(virtualPath, content);
    }
    const env = await encrypt(
      content,
      virtualPath,
      this.kek,
      zoneFor(virtualPath),
      kindFor(virtualPath),
    );
    return writeAtomic(virtualPath, env);
  }

  async delete(virtualPath: string): Promise<void> {
    return this.inner.delete(virtualPath);
  }

  /**
   * Rename a file or directory without going through the encrypt/decrypt path.
   * The bytes on disk are not touched. Used by the vault-reset flow to
   * tombstone an entire `_secure/` subtree, where each file's AAD-bound path
   * becomes stale until an undo restores the original directory name.
   *
   * Callers MUST own the higher-level invariant that any reads from the new
   * path will fail (or are intentional) — there is no AAD rebinding here.
   */
  async renameOpaque(src: string, dest: string): Promise<void> {
    return this.inner.move(src, dest);
  }

  async move(src: string, dest: string): Promise<void> {
    const srcE2E = this.predicates.isE2EEncrypted(src);
    const dstE2E = this.predicates.isE2EEncrypted(dest);
    if (srcE2E || dstE2E) {
      // Server cannot re-bind AAD for E2E paths. Renames/moves into or out of
      // _secure/ go through dedicated client-driven endpoints that re-encrypt
      // the payload before upload.
      throw new BadRequestException(
        'plain move() across end-to-end encrypted paths is not supported; use the dedicated move endpoints',
      );
    }
    const srcEnc = this.predicates.isEncryptedAtRest(src);
    const dstEnc = this.predicates.isEncryptedAtRest(dest);
    if (!srcEnc && !dstEnc) {
      return this.inner.move(src, dest);
    }
    // Either endpoint is encrypted at rest (server-keyed): the AAD on each
    // envelope binds the file's path, so a raw fs-level rename would leave
    // descendants undecryptable. Read (auto-decrypt) and re-write (auto-encrypt
    // for the new zone+path) for each file. Directories are walked.
    try {
      const buf = await this.readBytes(src);
      await this.writeBytes(dest, buf);
      await this.inner.delete(src);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'EISDIR') {
        await this.moveDirectoryReencrypt(src, dest);
        return;
      }
      throw err;
    }
  }

  /**
   * Walks `src`, re-encrypting each file at `dest` (rebinding AAD), then
   * deletes `src`. `list` skips dot entries, so each file's comment sidecar
   * (`.<name>.collab`) is carried explicitly; other dot entries are dropped.
   */
  private async moveDirectoryReencrypt(src: string, dest: string): Promise<void> {
    const entries = await this.inner.list(src);
    for (const e of entries) {
      const childSrc = e.path;
      const childDest = dest + e.path.slice(src.length);
      if (e.type === 'directory') {
        await this.moveDirectoryReencrypt(childSrc, childDest);
      } else {
        const buf = await this.readBytes(childSrc);
        await this.writeBytes(childDest, buf);
        const sidecar = sidecarPathOf(childSrc);
        if (await this.inner.exists(sidecar)) {
          await this.writeBytes(sidecarPathOf(childDest), await this.readBytes(sidecar));
        }
      }
    }
    await this.inner.delete(src);
  }

  async list(virtualPath: string): Promise<FileEntry[]> {
    return this.inner.list(virtualPath);
  }

  async exists(virtualPath: string): Promise<boolean> {
    return this.inner.exists(virtualPath);
  }

  async stat(virtualPath: string): Promise<{ mtime: Date }> {
    if (!this.inner.stat) throw new Error('inner adapter does not implement stat');
    return this.inner.stat(virtualPath);
  }

  watch(callback: (event: FileChangeEvent) => void): void {
    this.inner.watch(callback);
  }

  watchPersonal(callback: (event: FileChangeEvent) => void): void {
    if (this.inner.watchPersonal) this.inner.watchPersonal(callback);
  }

  async ensurePersonalFolder(email: string): Promise<void> {
    if (this.inner.ensurePersonalFolder) {
      await this.inner.ensurePersonalFolder(email);
    }
  }

  async ensureSecureFolder(email: string): Promise<void> {
    if (this.inner.ensureSecureFolder) {
      await this.inner.ensureSecureFolder(email);
    }
  }
}

function kindFor(virtualPath: string): EnvelopeKind {
  return virtualPath.includes('/_attachments/') ? 'attachment' : 'note';
}

/** Comment sidecar next to a note: `dir/.name.md.collab` (see SidecarService). */
function sidecarPathOf(virtualPath: string): string {
  const slash = virtualPath.lastIndexOf('/');
  const dir = slash < 0 ? '' : virtualPath.slice(0, slash + 1);
  return `${dir}.${virtualPath.slice(slash + 1)}.collab`;
}
