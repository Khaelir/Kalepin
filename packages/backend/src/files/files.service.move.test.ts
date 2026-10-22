import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConflictException } from '@nestjs/common';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { FilesService } from './files.service';

let tmpRoot: string;
let vault: string;
let storage: LocalFSAdapter;

function makeService(docHandles?: unknown): FilesService {
  return new FilesService(
    storage as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    docHandles as any,
  );
}

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-move-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  vault = path.join(tmpRoot, `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(vault, { recursive: true });
  storage = new LocalFSAdapter(vault);
});

describe('FilesService.move — destination collisions', () => {
  it('refuses to overwrite an existing file and leaves both untouched', async () => {
    await storage.write('a.md', 'A');
    await storage.write('b.md', 'B');
    await assert.rejects(makeService().move('a.md', 'b.md'), ConflictException);
    assert.equal(await storage.read('a.md'), 'A');
    assert.equal(await storage.read('b.md'), 'B');
  });

  it('refuses to move onto an existing folder', async () => {
    await storage.write('a.md', 'A');
    await storage.write('Folder/inside.md', 'x');
    await assert.rejects(makeService().move('a.md', 'Folder'), ConflictException);
    assert.equal(await storage.read('Folder/inside.md'), 'x');
  });

  it('treats a same-path move as a no-op', async () => {
    await storage.write('a.md', 'A');
    const calls: string[] = [];
    const service = makeService();
    service.registerMoveHooks({ beforeMove: async () => { calls.push('before'); } });
    await service.move('a.md', 'a.md');
    assert.equal(await storage.read('a.md'), 'A');
    assert.deepEqual(calls, []);
  });
});

describe('FilesService.move — hooks', () => {
  it('runs beforeMove while the file is still at src and afterMove once it is at dest', async () => {
    await storage.write('a.md', 'A');
    const seen: string[] = [];
    const service = makeService();
    service.registerMoveHooks({
      beforeMove: async (src) => { seen.push(`before:${await storage.exists(src)}`); },
      afterMove: async (_src, dest) => { seen.push(`after:${await storage.exists(dest)}`); },
    });
    await service.move('a.md', 'b.md');
    assert.deepEqual(seen, ['before:true', 'after:true']);
  });

  it('aborts the move when beforeMove throws', async () => {
    await storage.write('a.md', 'A');
    const service = makeService();
    service.registerMoveHooks({ beforeMove: async () => { throw new Error('flush failed'); } });
    await assert.rejects(service.move('a.md', 'b.md'), /flush failed/);
    assert.equal(await storage.read('a.md'), 'A');
    assert.equal(await storage.exists('b.md'), false);
  });

  it('does not fail the move when afterMove throws', async () => {
    await storage.write('a.md', 'A');
    const service = makeService();
    service.registerMoveHooks({ afterMove: async () => { throw new Error('boom'); } });
    await service.move('a.md', 'b.md');
    assert.equal(await storage.read('b.md'), 'A');
  });

  it('still runs afterMove when a bookkeeping step fails after the file moved', async () => {
    await storage.write('a.md', 'A');
    const failingHandles = {
      updatePathByPath: async () => { throw new Error('UNIQUE constraint failed: doc_handles.path'); },
      updatePathPrefix: async () => {},
    };
    const service = makeService(failingHandles);
    const after: string[] = [];
    service.registerMoveHooks({ afterMove: async (src, dest) => { after.push(`${src}->${dest}`); } });
    await assert.rejects(service.move('a.md', 'b.md'), /UNIQUE/);
    assert.deepEqual(after, ['a.md->b.md']);
  });
});
