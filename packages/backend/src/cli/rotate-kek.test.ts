import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { MemoryKEKSource } from '../crypto/kek-source';
import { encrypt, decrypt, rewrapEnvelope } from '../crypto/envelope';
import { rotateRoot, ZoneRoot } from './rotate-kek';

const USER = 'alice@x.com';

let tmpRoot: string;
let personal: ZoneRoot;
let shared: ZoneRoot;
let oldKek: MemoryKEKSource;
let newKek: MemoryKEKSource;
/** Stands in for a user's browser-held master-KEK. */
let clientKek: MemoryKEKSource;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-rotate-kek-'));
  personal = { zone: 'personal', root: path.join(tmpRoot, 'personal'), skipUsersAtRoot: false };
  shared = { zone: 'shared', root: path.join(tmpRoot, 'vault'), skipUsersAtRoot: true };
  oldKek = new MemoryKEKSource(crypto.randomBytes(32));
  newKek = new MemoryKEKSource(crypto.randomBytes(32));
  clientKek = new MemoryKEKSource(crypto.randomBytes(32));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** Writes an envelope for `virtualPath` at `rel` under `zr.root`. */
async function plant(zr: ZoneRoot, rel: string, virtualPath: string, kek: MemoryKEKSource): Promise<Buffer> {
  const env = await encrypt(Buffer.from(`body of ${rel}`), virtualPath, kek, zr.zone);
  const abs = path.join(zr.root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, env);
  return env;
}

const readAt = (zr: ZoneRoot, rel: string) => fs.readFile(path.join(zr.root, rel));

describe('rotate-kek — end-to-end encrypted files', () => {
  it('rotates server-keyed files and leaves _secure/ and tombstones alone', async () => {
    await plant(personal, `${USER}/note.md`, `_users/${USER}/note.md`, oldKek);
    const secure = await plant(personal, `${USER}/_secure/diary.md`, `_users/${USER}/_secure/diary.md`, clientKek);
    const tombstone = await plant(
      personal,
      `${USER}/_secure.tombstone-1700000000000/old.md`,
      `_users/${USER}/_secure/old.md`,
      clientKek,
    );
    await plant(shared, 'Notes/a.md', 'Notes/a.md', oldKek);

    const p = await rotateRoot(personal, oldKek, newKek);
    const s = await rotateRoot(shared, oldKek, newKek);

    assert.deepEqual(p, { rewrapped: 1, skipped: 0, passthrough: 0, endToEnd: 2 });
    assert.deepEqual(s, { rewrapped: 1, skipped: 0, passthrough: 0, endToEnd: 0 });
    const note = await decrypt(await readAt(personal, `${USER}/note.md`), `_users/${USER}/note.md`, newKek);
    assert.equal(note.toString(), `body of ${USER}/note.md`);
    assert.equal((await decrypt(await readAt(shared, 'Notes/a.md'), 'Notes/a.md', newKek)).toString(), 'body of Notes/a.md');
    assert.deepEqual(await readAt(personal, `${USER}/_secure/diary.md`), secure);
    assert.deepEqual(await readAt(personal, `${USER}/_secure.tombstone-1700000000000/old.md`), tombstone);
  });

  it('finishes a rotation that stopped partway when re-run', async () => {
    await plant(personal, `${USER}/a.md`, `_users/${USER}/a.md`, oldKek);
    await plant(personal, `${USER}/b.md`, `_users/${USER}/b.md`, oldKek);
    await plant(personal, `${USER}/_secure/diary.md`, `_users/${USER}/_secure/diary.md`, clientKek);
    // A previous run rewrapped a.md, then stopped.
    const abs = path.join(personal.root, `${USER}/a.md`);
    await fs.writeFile(abs, await rewrapEnvelope(await fs.readFile(abs), oldKek, newKek));

    const stats = await rotateRoot(personal, oldKek, newKek);

    assert.deepEqual(stats, { rewrapped: 1, skipped: 1, passthrough: 0, endToEnd: 1 });
    for (const name of ['a.md', 'b.md']) {
      const out = await decrypt(await readAt(personal, `${USER}/${name}`), `_users/${USER}/${name}`, newKek);
      assert.equal(out.toString(), `body of ${USER}/${name}`);
    }
  });
});
