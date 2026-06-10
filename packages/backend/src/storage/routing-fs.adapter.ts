import { FileEntry, FileChangeEvent } from '@kalepin/shared';
import { StorageAdapter } from './storage-adapter.interface';
import { LocalFSAdapter } from './local-fs.adapter';
import { PERSONAL_PREFIX, isPersonalRootSegment } from '../auth/visibility';

export class CrossPersonalMoveError extends Error {
  constructor(message = 'cross-personal move') {
    super(message);
    this.name = 'CrossPersonalMoveError';
  }
}

type Routed = { adapter: LocalFSAdapter; physicalPath: string; namespace: 'shared' | 'personal' };

export class RoutingStorageAdapter implements StorageAdapter {
  constructor(
    private readonly shared: LocalFSAdapter,
    private readonly personal: LocalFSAdapter,
  ) {}

  private route(virtualPath: string): Routed {
    if (virtualPath === '_users' || virtualPath === PERSONAL_PREFIX) {
      throw new CrossPersonalMoveError(`cannot route bare "${virtualPath}"`);
    }
    if (virtualPath.startsWith(PERSONAL_PREFIX)) {
      const inner = virtualPath.slice(PERSONAL_PREFIX.length);
      if (inner.length === 0) {
        throw new CrossPersonalMoveError('cannot route empty personal subpath');
      }
      if (inner.startsWith('.deleted/') || inner === '.deleted') {
        throw new CrossPersonalMoveError('cannot route into .deleted');
      }
      return { adapter: this.personal, physicalPath: inner, namespace: 'personal' };
    }
    return { adapter: this.shared, physicalPath: virtualPath, namespace: 'shared' };
  }

  async read(virtualPath: string): Promise<string> {
    const r = this.route(virtualPath);
    return r.adapter.read(r.physicalPath);
  }

  async write(virtualPath: string, content: string): Promise<void> {
    const r = this.route(virtualPath);
    return r.adapter.write(r.physicalPath, content);
  }

  async readBytes(virtualPath: string): Promise<Buffer> {
    const r = this.route(virtualPath);
    return r.adapter.readBytes(r.physicalPath);
  }

  async writeBytes(virtualPath: string, content: Buffer): Promise<void> {
    const r = this.route(virtualPath);
    return r.adapter.writeBytes(r.physicalPath, content);
  }

  async writeBytesAtomic(virtualPath: string, content: Buffer): Promise<void> {
    const r = this.route(virtualPath);
    return r.adapter.writeBytesAtomic(r.physicalPath, content);
  }

  async writeBytesAtomicDurable(virtualPath: string, content: Buffer): Promise<void> {
    const r = this.route(virtualPath);
    return r.adapter.writeBytesAtomicDurable(r.physicalPath, content);
  }

  async delete(virtualPath: string): Promise<void> {
    const r = this.route(virtualPath);
    return r.adapter.delete(r.physicalPath);
  }

  async exists(virtualPath: string): Promise<boolean> {
    try {
      const r = this.route(virtualPath);
      return r.adapter.exists(r.physicalPath);
    } catch {
      return false;
    }
  }

  async stat(virtualPath: string): Promise<{ mtime: Date }> {
    const r = this.route(virtualPath);
    if (!r.adapter.stat) throw new Error('underlying adapter does not support stat');
    return r.adapter.stat(r.physicalPath);
  }

  async move(src: string, dest: string): Promise<void> {
    if (isPersonalRootSegment(src)) {
      throw new CrossPersonalMoveError('cannot move personal root segment');
    }
    if (dest === '_users' || dest === PERSONAL_PREFIX || isPersonalRootSegment(dest)) {
      throw new CrossPersonalMoveError('cannot move into _users root or another user root');
    }

    const srcPersonal = src.startsWith(PERSONAL_PREFIX);
    const destPersonal = dest.startsWith(PERSONAL_PREFIX);

    // Same-namespace moves go through the underlying adapter (atomic rename).
    if (!srcPersonal && !destPersonal) {
      return this.shared.move(src, dest);
    }
    if (srcPersonal && destPersonal) {
      const srcInner = src.slice(PERSONAL_PREFIX.length);
      const destInner = dest.slice(PERSONAL_PREFIX.length);
      const srcEmail = srcInner.split('/')[0];
      const destEmail = destInner.split('/')[0];
      if (srcEmail !== destEmail) {
        throw new CrossPersonalMoveError('cannot move between two distinct personal roots');
      }
      return this.personal.move(srcInner, destInner);
    }

    // Cross-namespace move: copy + delete (each adapter only knows its own physical tree).
    const content = await this.read(src);
    await this.write(dest, content);
    await this.delete(src);
  }

  async list(virtualPath: string): Promise<FileEntry[]> {
    if (virtualPath === '' || virtualPath === '/') {
      return this.shared.list('');
    }
    if (virtualPath === '_users' || virtualPath === PERSONAL_PREFIX) {
      return [];
    }
    if (virtualPath.startsWith(PERSONAL_PREFIX)) {
      const inner = virtualPath.slice(PERSONAL_PREFIX.length);
      const entries = await this.personal.list(inner);
      return entries.map((e) => prefixEntry(e, PERSONAL_PREFIX));
    }
    return this.shared.list(virtualPath);
  }

  watch(callback: (event: FileChangeEvent) => void): void {
    // Shared watcher only — personal subtrees are watched separately via watchPersonal.
    this.shared.watch(callback);
  }

  /**
   * Watch the personal root and emit virtual paths of the form `_users/{email}/...`.
   * Events whose physical path segment can't be parsed (e.g. top-level reserved dirs
   * like `.deleted`) are dropped.
   *
   * Phase 12: this is a single global personal watcher rather than the lazy-per-user
   * variant described in design.md. The leak-prevention property still holds because
   * the gateway routes events to `clientsByEmail.get(email)` only.
   */
  watchPersonal(callback: (event: FileChangeEvent) => void): void {
    this.personal.watch((event) => {
      const physical = event.path;
      if (!physical) return;
      const firstSep = physical.indexOf('/');
      const email = firstSep === -1 ? physical : physical.slice(0, firstSep);
      if (!email || email.startsWith('.')) return; // skip .deleted, hidden
      callback({ event: event.event, path: PERSONAL_PREFIX + physical });
    });
  }

  async ensurePersonalFolder(email: string): Promise<void> {
    // Idempotent: write+delete a sentinel? Simpler: create the dir via mkdir-on-write.
    // We achieve this by writing a zero-byte sentinel and deleting it, but that races.
    // Cleanest path: use the underlying mkdir directly via exists+write pattern.
    const dir = email;
    const exists = await this.personal.exists(dir);
    if (exists) return;
    // LocalFSAdapter.write(dir, content) treats `dir` as a file. We need a directory.
    // Use a private helper: write a transient file under the dir, then delete it.
    const sentinel = `${email}/.kalepin-init`;
    await this.personal.write(sentinel, '');
    await this.personal.delete(sentinel);
  }

  /**
   * Idempotent: create `_users/{email}/_secure/` if missing. Bypasses the
   * encrypting adapter on purpose — the directory itself carries no payload,
   * and we want the folder to surface in the file tree the moment the user
   * sets up their vault, before any envelope has been written.
   */
  async ensureSecureFolder(email: string): Promise<void> {
    const dir = `${email}/_secure`;
    const exists = await this.personal.exists(dir);
    if (exists) return;
    const sentinel = `${dir}/.kalepin-init`;
    await this.personal.write(sentinel, '');
    await this.personal.delete(sentinel);
  }

  /**
   * Soft-delete a user's personal folder by moving it to `.deleted/{email}-{ts}/`.
   * Intended to be called by an admin user-deletion flow. The destination folder is
   * unreachable through the routing adapter (paths starting with `_users/.deleted/`
   * are rejected at `route()`), so the soft-deleted content is admin-only.
   *
   * Returns the resulting `.deleted/...` path (relative to PERSONAL_PATH) for logging.
   * No-op (returns null) if the user folder doesn't exist.
   */
  async softDeletePersonalFolder(email: string): Promise<string | null> {
    const canonical = email.toLowerCase();
    const exists = await this.personal.exists(canonical);
    if (!exists) return null;
    // Use ISO 8601 with `-` instead of `:` for Windows compatibility.
    const ts = new Date().toISOString().replace(/:/g, '-');
    const dest = `.deleted/${canonical}-${ts}`;
    await this.personal.move(canonical, dest);
    return dest;
  }
}

function prefixEntry(entry: FileEntry, prefix: string): FileEntry {
  const next: FileEntry = {
    name: entry.name,
    path: prefix + entry.path,
    type: entry.type,
  };
  if (entry.type === 'directory' && entry.children) {
    next.children = entry.children.map((c) => prefixEntry(c, prefix));
  }
  return next;
}
