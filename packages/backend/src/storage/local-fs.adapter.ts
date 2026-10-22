import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { watch } from 'chokidar';
import { FileEntry, FileChangeEvent } from '@kalepin/shared';
import { StorageAdapter } from './storage-adapter.interface';
import { FsyncCoalescer, getSharedCoalescer } from './fsync-coalescer';

const ATOMIC_WRITE_TMP_PATTERN = /(?:^|\/)[^/]+\.tmp\.[0-9a-f]+$/;

export function isAtomicWriteTmpPath(p: string): boolean {
  return ATOMIC_WRITE_TMP_PATTERN.test(p);
}

export class LocalFSAdapter implements StorageAdapter {
  private readonly coalescer: FsyncCoalescer;

  constructor(
    protected readonly vaultPath: string,
    coalescer?: FsyncCoalescer,
  ) {
    this.coalescer = coalescer ?? getSharedCoalescer();
  }

  protected resolve(filePath: string): string {
    // Compare whole path segments: a bare `startsWith(vaultPath)` would also
    // accept a sibling such as `/data/vault-old` for `/data/vault`.
    const root = path.resolve(this.vaultPath);
    const resolved = path.resolve(root, filePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  async read(filePath: string): Promise<string> {
    return fs.readFile(this.resolve(filePath), 'utf-8');
  }

  async write(filePath: string, content: string): Promise<void> {
    const resolved = this.resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  }

  async readBytes(filePath: string): Promise<Buffer> {
    return fs.readFile(this.resolve(filePath));
  }

  async writeBytes(filePath: string, content: Buffer): Promise<void> {
    const resolved = this.resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content);
  }

  async writeBytesAtomic(filePath: string, content: Buffer): Promise<void> {
    const resolved = this.resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const tmp = `${resolved}.tmp.${crypto.randomBytes(6).toString('hex')}`;
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, resolved);
    this.coalescer.markDirty(resolved);
  }

  async writeBytesAtomicDurable(filePath: string, content: Buffer): Promise<void> {
    const resolved = this.resolve(filePath);
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${resolved}.tmp.${crypto.randomBytes(6).toString('hex')}`;
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, resolved);
    const dirHandle = await fs.open(dir, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  }

  async delete(filePath: string): Promise<void> {
    const resolved = this.resolve(filePath);
    if (resolved === path.resolve(this.vaultPath)) {
      throw new Error('Refusing to delete the storage root');
    }
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true });
    } else {
      await fs.unlink(resolved);
    }
  }

  async move(src: string, dest: string): Promise<void> {
    const resolvedSrc = this.resolve(src);
    const resolvedDest = this.resolve(dest);
    await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
    await fs.rename(resolvedSrc, resolvedDest);
  }

  async list(dir: string): Promise<FileEntry[]> {
    const resolved = this.resolve(dir);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const children = await this.list(entryPath);
        result.push({ name: entry.name, path: entryPath, type: 'directory', children });
      } else {
        result.push({ name: entry.name, path: entryPath, type: 'file' });
      }
    }

    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async stat(filePath: string): Promise<{ mtime: Date }> {
    const s = await fs.stat(this.resolve(filePath));
    return { mtime: s.mtime };
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  watch(callback: (event: FileChangeEvent) => void): void {
    const watcher = watch(this.vaultPath, {
      ignored: /(^|[/\\])\../, // ignore dot files
      persistent: true,
      ignoreInitial: true,
    });

    const handle = (event: FileChangeEvent['event']) => (fullPath: string) => {
      const relativePath = path.relative(this.vaultPath, fullPath);
      callback({ event, path: relativePath });
    };

    watcher.on('add', handle('add'));
    watcher.on('change', handle('change'));
    watcher.on('unlink', handle('unlink'));
    watcher.on('addDir', handle('addDir'));
    watcher.on('unlinkDir', handle('unlinkDir'));
  }
}

/**
 * Verify the vault directory is writable and `fsync`-capable. Throws at module
 * init if the vault is on a misconfigured filesystem (e.g. read-only mount,
 * tmpfs without sync support). Surfacing this loudly at boot is preferable to
 * having a backup or migration sweep silently degrade later. Synchronous so it
 * can run inside the StorageModule factory.
 */
export function assertVaultWritableAndSyncable(vaultPath: string): void {
  fsSync.mkdirSync(vaultPath, { recursive: true });
  const probe = path.join(vaultPath, `.kalepin-fsync-check.${process.pid}.${Date.now()}`);
  const fd = fsSync.openSync(probe, 'w');
  try {
    fsSync.writeSync(fd, Buffer.from('ok'));
    fsSync.fsyncSync(fd);
  } finally {
    fsSync.closeSync(fd);
  }
  try {
    fsSync.unlinkSync(probe);
  } catch {
    // best-effort cleanup
  }
}
