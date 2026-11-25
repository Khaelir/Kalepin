import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { EncryptingStorageAdapter } from '../storage/encrypting-fs.adapter';
import { MemoryKEKSource } from '../crypto/kek-source';
import { encrypt } from '../crypto/envelope';
import { EncryptionPredicates } from '../crypto/encryption-predicates';
import { SidecarService } from './sidecar.service';

class EncryptedZone implements EncryptionPredicates {
  isEncryptedAtRest(): boolean { return true; }
  isE2EEncrypted(): boolean { return false; }
  shouldIndexPlaintext(): boolean { return true; }
  canCollab(): boolean { return true; }
  commentBodiesEncrypted(): boolean { return false; }
  shareLinkMintable(): boolean { return true; }
}

let tmpRoot: string;
let sidecars: SidecarService;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-sidecar-'));
  const adapter = new EncryptingStorageAdapter(
    new LocalFSAdapter(tmpRoot),
    new MemoryKEKSource(crypto.randomBytes(32)),
    new EncryptedZone(),
  );
  sidecars = new SidecarService(adapter);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('SidecarService.read', () => {
  it('returns no comments when the note has no sidecar', async () => {
    assert.deepEqual(await sidecars.read('Notes/plan.md'), { comments: {} });
  });

  it('round-trips through the encrypting adapter', async () => {
    const data = { comments: { b1: { threads: [] } } };
    await sidecars.write('Notes/plan.md', data);
    assert.deepEqual(await sidecars.read('Notes/plan.md'), data);
  });

  it('refuses a sidecar it cannot decrypt instead of reporting no comments', async () => {
    // e.g. still wrapped by the KEK in use before a rotation.
    const otherKek = new MemoryKEKSource(crypto.randomBytes(32));
    const abs = path.join(tmpRoot, 'Notes/.plan.md.collab');
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, await encrypt(Buffer.from('{"comments":{"b1":{"threads":[]}}}'), 'Notes/.plan.md.collab', otherKek, 'shared'));

    await assert.rejects(() => sidecars.read('Notes/plan.md'), /wrong KEK/);
  });
});
