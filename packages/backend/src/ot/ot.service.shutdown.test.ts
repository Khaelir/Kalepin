import 'reflect-metadata';
import { describe, it, before, after, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { OTService } from './ot.service';

// Nothing saved open notes on SIGTERM: each deploy lost the acked edits
// still waiting for their debounced flush.

let tmpRoot: string;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-ot-shutdown-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

afterEach(() => {
  mock.timers.reset();
});

describe('OTService shutdown hook', () => {
  it('saves the unsaved edits of every open note', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const storage = new LocalFSAdapter(tmpRoot);
    await storage.write('a.md', 'hello');
    const ot = new OTService(storage, { save: async () => undefined } as any, { trackChange: async () => undefined } as any);
    await ot.openDocument('a.md', {} as any, 1, 'alice@example.com');
    await ot.applyOperation('a.md', [{ type: 'retain', count: 5 }, { type: 'insert', text: ' world' }], 0, 1);

    await ot.beforeApplicationShutdown();

    assert.equal(await storage.read('a.md'), 'hello world');
  });
});
