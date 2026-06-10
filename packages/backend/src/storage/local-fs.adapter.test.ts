import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalFSAdapter, assertVaultWritableAndSyncable } from './local-fs.adapter';
import { FsyncCoalescer } from './fsync-coalescer';

let tmpRoot: string;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-localfs-test-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('LocalFSAdapter — fsync split', () => {
  it('writeBytesAtomic does NOT fsync (file handle.sync is not invoked)', async () => {
    const coalescer = new FsyncCoalescer(60_000);
    coalescer.start();
    try {
      const root = await fs.mkdtemp(path.join(tmpRoot, 'no-fsync-'));
      const adapter = new LocalFSAdapter(root, coalescer);

      // Spy on fs.promises.open to detect fsync calls on file handles created
      // during this write. `handle.sync()` is what we want to NOT see.
      const origOpen = fs.open;
      let fileSyncCalls = 0;
      const fhWrap = async (...args: Parameters<typeof origOpen>) => {
        const handle = await origOpen.apply(fs, args);
        const origSync = handle.sync.bind(handle);
        handle.sync = async () => {
          fileSyncCalls++;
          return origSync();
        };
        return handle;
      };
      // @ts-expect-error monkey-patching for the test
      fs.open = fhWrap;
      try {
        await adapter.writeBytesAtomic('foo.md', Buffer.from('hello'));
      } finally {
        // @ts-expect-error restore
        fs.open = origOpen;
      }
      assert.equal(fileSyncCalls, 0, 'writeBytesAtomic must not fsync the file');
      const written = await fs.readFile(path.join(root, 'foo.md'), 'utf-8');
      assert.equal(written, 'hello');
      // Coalescer was given the resolved path.
      assert.equal(coalescer.hasDirty(path.join(root, 'foo.md')), true);
    } finally {
      coalescer.shutdown();
    }
  });

  it('writeBytesAtomicDurable fsyncs file and parent directory', async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, 'durable-'));
    const coalescer = new FsyncCoalescer(60_000);
    coalescer.start();
    try {
      const adapter = new LocalFSAdapter(root, coalescer);
      const origOpen = fs.open;
      let fileSyncCalls = 0;
      let dirSyncCalls = 0;
      const fhWrap = async (...args: Parameters<typeof origOpen>) => {
        const handle = await origOpen.apply(fs, args);
        const origSync = handle.sync.bind(handle);
        const target = args[0] as string;
        handle.sync = async () => {
          if (target.includes('.tmp.')) {
            fileSyncCalls++;
          } else {
            dirSyncCalls++;
          }
          return origSync();
        };
        return handle;
      };
      // @ts-expect-error monkey-patching for the test
      fs.open = fhWrap;
      try {
        await adapter.writeBytesAtomicDurable('bar.md', Buffer.from('persisted'));
      } finally {
        // @ts-expect-error restore
        fs.open = origOpen;
      }
      assert.equal(fileSyncCalls, 1, 'must fsync the file before rename');
      assert.equal(dirSyncCalls, 1, 'must fsync the parent directory after rename');

      const written = await fs.readFile(path.join(root, 'bar.md'), 'utf-8');
      assert.equal(written, 'persisted');
      // Durable writes do NOT enter the coalescer.
      assert.equal(coalescer.hasDirty(path.join(root, 'bar.md')), false);
    } finally {
      coalescer.shutdown();
    }
  });

  it('writeBytesAtomic content is observable on disk immediately after the call returns', async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, 'observable-'));
    const coalescer = new FsyncCoalescer(60_000);
    coalescer.start();
    try {
      const adapter = new LocalFSAdapter(root, coalescer);
      await adapter.writeBytesAtomic('obs.md', Buffer.from('see me'));
      const back = await fs.readFile(path.join(root, 'obs.md'), 'utf-8');
      assert.equal(back, 'see me');
    } finally {
      coalescer.shutdown();
    }
  });

  it('atomicity: under concurrent reads the reader observes either prior or new content, never partial', async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, 'atomic-'));
    const coalescer = new FsyncCoalescer(60_000);
    coalescer.start();
    try {
      const adapter = new LocalFSAdapter(root, coalescer);
      await adapter.writeBytesAtomic('race.md', Buffer.from('A'.repeat(1024)));

      const writes: Promise<unknown>[] = [];
      const reads: Promise<unknown>[] = [];
      let badRead = 0;

      for (let i = 0; i < 20; i++) {
        writes.push(adapter.writeBytesAtomic('race.md', Buffer.from((i % 2 === 0 ? 'B' : 'A').repeat(1024))));
        reads.push(
          fs.readFile(path.join(root, 'race.md'), 'utf-8').then((c) => {
            const allA = c === 'A'.repeat(1024);
            const allB = c === 'B'.repeat(1024);
            if (!allA && !allB) badRead++;
          }),
        );
      }
      await Promise.all([...writes, ...reads]);
      assert.equal(badRead, 0, 'no read should observe partial bytes');
    } finally {
      coalescer.shutdown();
    }
  });
});

describe('assertVaultWritableAndSyncable', () => {
  it('passes for a writable directory', async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, 'probe-'));
    assert.doesNotThrow(() => assertVaultWritableAndSyncable(root));
    // No leftover probe files.
    const entries = await fs.readdir(root);
    assert.deepEqual(entries.filter((n) => n.startsWith('.kalepin-fsync-check')), []);
  });

  it('throws for a non-writable directory', async () => {
    if (process.platform === 'win32') return; // mode bits are unreliable on Windows
    const root = await fs.mkdtemp(path.join(tmpRoot, 'ro-'));
    fsSync.chmodSync(root, 0o500);
    try {
      assert.throws(() => assertVaultWritableAndSyncable(root));
    } finally {
      fsSync.chmodSync(root, 0o700);
    }
  });
});
