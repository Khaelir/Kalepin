import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { ArchiveLike, appendVirtualTreeToArchive } from './download-zip';

// The per-user vault zip must not ship the trash: it walks `storage.list`,
// which skips dot folders. (Admin backups tar the physical roots and do
// include `.trash/`.)

let tmpRoot: string;
let storage: RoutingStorageAdapter;

async function write(abs: string, body: string) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-zip-trash-'));
  const vault = path.join(tmpRoot, 'vault');
  const personal = path.join(tmpRoot, 'personal');
  await write(path.join(vault, 'a.md'), 'a');
  await write(path.join(vault, '.trash/abc/gone.md'), 'g');
  await write(path.join(personal, 'alice@x.com/mine.md'), 'm');
  await write(path.join(personal, 'alice@x.com/.trash/def/old.md'), 'o');
  storage = new RoutingStorageAdapter(new LocalFSAdapter(vault), new LocalFSAdapter(personal));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('download-zip — trash', () => {
  it('leaves shared and personal trash folders out of the archive', async () => {
    const names: string[] = [];
    const archive: ArchiveLike = { append: (_data, opts) => { names.push(opts.name); } };
    await appendVirtualTreeToArchive(archive, storage, '', { skipPersonalAtRoot: true });
    await appendVirtualTreeToArchive(archive, storage, '_users/alice@x.com', { skipPersonalAtRoot: false });
    assert.deepEqual(names.sort(), ['_users/alice@x.com/mine.md', 'a.md']);
  });
});
