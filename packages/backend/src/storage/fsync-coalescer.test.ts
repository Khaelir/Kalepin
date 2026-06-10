import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FsyncCoalescer } from './fsync-coalescer';

let tmpRoot: string;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-coalescer-test-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('FsyncCoalescer', () => {
  it('flushes paths on its interval', async () => {
    const coalescer = new FsyncCoalescer(50);
    coalescer.start();
    try {
      const p = path.join(tmpRoot, `flush-${Date.now()}.txt`);
      await fs.writeFile(p, 'hi');
      coalescer.markDirty(p);
      assert.equal(coalescer.dirtyCount(), 1);

      await new Promise((r) => setTimeout(r, 120));
      assert.equal(coalescer.dirtyCount(), 0);
    } finally {
      coalescer.shutdown();
    }
  });

  it('manual flush() drains dirty set', async () => {
    const coalescer = new FsyncCoalescer(60_000);
    coalescer.start();
    try {
      const p = path.join(tmpRoot, `manual-${Date.now()}.txt`);
      await fs.writeFile(p, 'hi');
      coalescer.markDirty(p);
      await coalescer.flush();
      assert.equal(coalescer.dirtyCount(), 0);
    } finally {
      coalescer.shutdown();
    }
  });

  it('shutdown synchronously flushes remaining paths', async () => {
    const coalescer = new FsyncCoalescer(60_000);
    coalescer.start();
    const p = path.join(tmpRoot, `shutdown-${Date.now()}.txt`);
    await fs.writeFile(p, 'hi');
    coalescer.markDirty(p);
    assert.equal(coalescer.dirtyCount(), 1);
    coalescer.shutdown();
    assert.equal(coalescer.dirtyCount(), 0);
  });

  it('tolerates a path that no longer exists (ENOENT)', async () => {
    const coalescer = new FsyncCoalescer(60_000);
    coalescer.start();
    try {
      const p = path.join(tmpRoot, 'definitely-missing.txt');
      coalescer.markDirty(p);
      // Should not throw.
      await coalescer.flush();
      assert.equal(coalescer.dirtyCount(), 0);
    } finally {
      coalescer.shutdown();
    }
  });

  it('does not double-mark the same path', () => {
    const coalescer = new FsyncCoalescer(60_000);
    coalescer.start();
    try {
      const p = '/some/path';
      coalescer.markDirty(p);
      coalescer.markDirty(p);
      coalescer.markDirty(p);
      assert.equal(coalescer.dirtyCount(), 1);
    } finally {
      coalescer.shutdown();
    }
  });
});
