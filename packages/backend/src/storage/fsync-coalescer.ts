import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';

const DEFAULT_FLUSH_INTERVAL_MS = 2000;

/**
 * Maintains a set of paths recently written via `writeBytesAtomic` (without
 * fsync) and issues a fsync for each one every `flushIntervalMs`. Bounds the
 * kernel-writeback gap to ~one interval for OT-flushed content while keeping
 * the per-write hot path off the disk.
 *
 * On `beforeExit` (and explicit `shutdown()`), all dirty paths are fsynced
 * synchronously before the process exits.
 */
export class FsyncCoalescer {
  private readonly logger = new Logger('FsyncCoalescer');
  private readonly dirty = new Set<string>();
  private readonly flushIntervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private beforeExitListener: (() => void) | null = null;
  private flushing = false;
  private stopped = false;

  constructor(flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS) {
    this.flushIntervalMs = flushIntervalMs;
  }

  start(): void {
    if (this.interval || this.stopped) return;
    this.interval = setInterval(() => {
      this.flush().catch((err) => {
        this.logger.warn(`coalescer flush failed: ${(err as Error).message}`);
      });
    }, this.flushIntervalMs);
    this.interval.unref?.();

    this.beforeExitListener = () => {
      this.flushSync();
    };
    process.on('beforeExit', this.beforeExitListener);
  }

  markDirty(absolutePath: string): void {
    if (this.stopped) return;
    this.dirty.add(absolutePath);
  }

  /** Async flush of all currently-dirty paths. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.dirty.size === 0) return;
    this.flushing = true;
    const paths = Array.from(this.dirty);
    this.dirty.clear();
    try {
      for (const p of paths) {
        try {
          const handle = await fs.open(p, 'r');
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
        } catch (err) {
          // ENOENT is benign — file was deleted/renamed before we could flush.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            this.logger.warn(`fsync failed for ${p}: ${(err as Error).message}`);
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Synchronously fsync all dirty paths. Used in `beforeExit` where the event
   * loop is about to stop running async tasks. Uses `fs.openSync`/`fsyncSync`.
   */
  flushSync(): void {
    if (this.dirty.size === 0) return;
    const fsSync = require('fs') as typeof import('fs');
    const paths = Array.from(this.dirty);
    this.dirty.clear();
    for (const p of paths) {
      try {
        const fd = fsSync.openSync(p, 'r');
        try {
          fsSync.fsyncSync(fd);
        } finally {
          fsSync.closeSync(fd);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`final fsync failed for ${p}: ${(err as Error).message}`);
        }
      }
    }
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.beforeExitListener) {
      process.removeListener('beforeExit', this.beforeExitListener);
      this.beforeExitListener = null;
    }
    this.flushSync();
  }

  /** Test helper — exposed for unit tests. */
  hasDirty(absolutePath: string): boolean {
    return this.dirty.has(absolutePath);
  }

  /** Test helper — exposed for unit tests. */
  dirtyCount(): number {
    return this.dirty.size;
  }
}

let sharedCoalescer: FsyncCoalescer | null = null;

/**
 * Process-singleton coalescer. The first caller starts the interval; subsequent
 * callers reuse the same instance. The storage module wires this through
 * `LocalFSAdapter`.
 */
export function getSharedCoalescer(): FsyncCoalescer {
  if (!sharedCoalescer) {
    sharedCoalescer = new FsyncCoalescer();
    sharedCoalescer.start();
  }
  return sharedCoalescer;
}

/** Test-only — reset the singleton between integration tests. */
export function resetSharedCoalescerForTests(): void {
  if (sharedCoalescer) {
    sharedCoalescer.shutdown();
  }
  sharedCoalescer = null;
}
