import { FileEntry, FileChangeEvent } from '@kalepin/shared';

export interface StorageAdapter {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  move(src: string, dest: string): Promise<void>;
  list(dir: string): Promise<FileEntry[]>;
  exists(path: string): Promise<boolean>;
  watch(callback: (event: FileChangeEvent) => void): void;
  /** Watch the personal root and emit virtual `_users/{email}/...` paths. Implemented by RoutingStorageAdapter only. */
  watchPersonal?(callback: (event: FileChangeEvent) => void): void;
  /** Idempotent: create `_users/{email}/`. Implemented by RoutingStorageAdapter (and forwarded by EncryptingStorageAdapter). */
  ensurePersonalFolder?(email: string): Promise<void>;
  /** Idempotent: create `_users/{email}/_secure/`. Same forwarding rules as ensurePersonalFolder. */
  ensureSecureFolder?(email: string): Promise<void>;
  stat?(path: string): Promise<{ mtime: Date }>;

  /** Raw byte read (no utf-8 decode). Required for binary content and the encryption boundary. */
  readBytes?(path: string): Promise<Buffer>;
  /** Raw byte write (no utf-8 encode). */
  writeBytes?(path: string, content: Buffer): Promise<void>;
  /**
   * Atomic byte write (best-effort durability): tmp + rename. Does NOT fsync —
   * a background coalescer fsyncs recently-written paths every ~2s. Used for
   * OT flushes and other "with the kernel" durability needs.
   */
  writeBytesAtomic?(path: string, content: Buffer): Promise<void>;
  /**
   * Atomic byte write with platter durability: tmp + file fsync + rename +
   * parent-directory fsync. Used by the encryption sweep, backup writes, and
   * any caller that needs the bytes guaranteed past hard-power-loss before
   * returning.
   */
  writeBytesAtomicDurable?(path: string, content: Buffer): Promise<void>;

  // Git-only extensions (optional)
  history?(path: string): Promise<Commit[]>;
  diff?(path: string, rev1: string, rev2: string): Promise<string>;
  commitAll?(message: string): Promise<void>;
}

export interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export const STORAGE_ADAPTER = 'STORAGE_ADAPTER';
