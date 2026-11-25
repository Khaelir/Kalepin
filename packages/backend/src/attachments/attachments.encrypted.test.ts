import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { LocalFSAdapter } from '../storage/local-fs.adapter';
import { RoutingStorageAdapter } from '../storage/routing-fs.adapter';
import { EncryptingStorageAdapter } from '../storage/encrypting-fs.adapter';
import { MemoryKEKSource } from '../crypto/kek-source';
import { encrypt } from '../crypto/envelope';
import { EncryptionPredicates, isE2EPath } from '../crypto/encryption-predicates';
import { REQUIRED_SCOPE_KEY } from '../auth/required-scope.decorator';
import { SCOPE_PERMISSIONS } from '../auth/permissions';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';

// The orphan cleanup in encrypted zones: notes on disk are envelopes, so the
// reference scan must read them through the storage adapter, and must not
// trash anything a note it cannot read might reference.

class BothZonesEncrypted implements EncryptionPredicates {
  isEncryptedAtRest(): boolean { return true; }
  isE2EEncrypted(p: string): boolean { return isE2EPath(p); }
  shouldIndexPlaintext(p: string): boolean { return !isE2EPath(p); }
  canCollab(p: string): boolean { return !isE2EPath(p); }
  commentBodiesEncrypted(p: string): boolean { return isE2EPath(p); }
  shareLinkMintable(p: string): boolean { return !isE2EPath(p); }
}

const USER = 'alice@x.com';

let tmpRoot: string;
let vaultPath: string;
let personalPath: string;
let userRoot: string;
let kek: MemoryKEKSource;
let adapter: EncryptingStorageAdapter;
let service: AttachmentsService;
let prevVault: string | undefined;
let prevPersonal: string | undefined;

async function writeRaw(abs: string, body: string | Buffer) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

const exists = (abs: string) => fs.access(abs).then(() => true, () => false);

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-attach-enc-'));
  vaultPath = path.join(tmpRoot, 'vault');
  personalPath = path.join(tmpRoot, 'personal');
  userRoot = path.join(personalPath, USER);
  await fs.mkdir(vaultPath, { recursive: true });
  await fs.mkdir(userRoot, { recursive: true });
  prevVault = process.env.VAULT_PATH;
  prevPersonal = process.env.PERSONAL_PATH;
  process.env.VAULT_PATH = vaultPath;
  process.env.PERSONAL_PATH = personalPath;
  kek = new MemoryKEKSource(crypto.randomBytes(32));
  adapter = new EncryptingStorageAdapter(
    new RoutingStorageAdapter(new LocalFSAdapter(vaultPath), new LocalFSAdapter(personalPath)),
    kek,
    new BothZonesEncrypted(),
  );
  service = new AttachmentsService(undefined, adapter);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  if (prevVault === undefined) delete process.env.VAULT_PATH;
  else process.env.VAULT_PATH = prevVault;
  if (prevPersonal === undefined) delete process.env.PERSONAL_PATH;
  else process.env.PERSONAL_PATH = prevPersonal;
});

describe('Attachment cleanup — encrypted zones', () => {
  it('keeps attachments referenced by encrypted notes', async () => {
    await adapter.write('Notes/doc.md', '![](../_attachments/shared-used.png)');
    await writeRaw(path.join(vaultPath, '_attachments/shared-used.png'), 'u');
    await writeRaw(path.join(vaultPath, '_attachments/shared-orphan.png'), 'o');
    await adapter.write(`_users/${USER}/.trash/abc/diary.md`, '![](../../_attachments/mine.png)');
    await writeRaw(path.join(userRoot, '_attachments/mine.png'), 'm');

    const result = await service.cleanup();

    assert.equal(result.orphansFound, 1);
    assert.equal(await exists(path.join(vaultPath, '_attachments/shared-used.png')), true);
    assert.equal(await exists(path.join(vaultPath, '_attachments/shared-orphan.png')), false);
    assert.equal(await exists(path.join(userRoot, '_attachments/mine.png')), true);
  });

  it('trashes nothing in a namespace holding an end-to-end encrypted note', async () => {
    // The server cannot read `_secure/` notes, which can reference attachments.
    const opaque = await encrypt(Buffer.from('![](../_attachments/secret.png)'), `_users/${USER}/_secure/s.md`, new MemoryKEKSource(crypto.randomBytes(32)), 'personal');
    await writeRaw(path.join(userRoot, '_secure/s.md'), opaque);
    await writeRaw(path.join(userRoot, '_attachments/secret.png'), 's');
    await writeRaw(path.join(vaultPath, '_attachments/shared-orphan.png'), 'o');

    const result = await service.cleanup();

    assert.equal(result.orphansFound, 1, 'the shared namespace is still cleaned');
    assert.equal(await exists(path.join(userRoot, '_attachments/secret.png')), true);
    assert.equal(await exists(path.join(vaultPath, '_attachments/shared-orphan.png')), false);
  });

  it('trashes and purges nothing in a namespace with a note it cannot decrypt', async () => {
    const otherKek = new MemoryKEKSource(crypto.randomBytes(32));
    await writeRaw(path.join(vaultPath, 'Notes/doc.md'), await encrypt(Buffer.from('![](_attachments/a.png)'), 'Notes/doc.md', otherKek, 'shared'));
    await writeRaw(path.join(vaultPath, '_attachments/a.png'), 'a');
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await writeRaw(path.join(vaultPath, `_attachments/.trash/${old}_b.png`), 'b');

    const result = await service.cleanup();

    assert.deepEqual(result, { orphansFound: 0, movedToTrash: 0, purgedFromTrash: 0 });
    assert.equal(await exists(path.join(vaultPath, '_attachments/a.png')), true);
    assert.equal(await exists(path.join(vaultPath, `_attachments/.trash/${old}_b.png`)), true);
  });

  it('puts back trashed attachments that a note references instead of purging them', async () => {
    // e.g. trashed by an earlier run that read the encrypted notes as ciphertext.
    await adapter.write('Notes/doc.md', '![](../_attachments/back.png)');
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await writeRaw(path.join(vaultPath, `_attachments/.trash/${old}_back.png`), 'b');
    await writeRaw(path.join(vaultPath, `_attachments/.trash/${old}_gone.png`), 'g');

    const result = await service.cleanup();

    assert.equal(result.purgedFromTrash, 1);
    assert.equal(await fs.readFile(path.join(vaultPath, '_attachments/back.png'), 'utf-8'), 'b');
    assert.deepEqual(await fs.readdir(path.join(vaultPath, '_attachments/.trash')), []);
  });

  it('treats envelopes as unreadable when no storage adapter is wired', async () => {
    const bare = new AttachmentsService();
    await adapter.write('Notes/doc.md', '![](../_attachments/a.png)');
    await writeRaw(path.join(vaultPath, '_attachments/a.png'), 'a');

    const result = await bare.cleanup();

    assert.equal(result.orphansFound, 0);
    assert.equal(await exists(path.join(vaultPath, '_attachments/a.png')), true);
  });
});

describe('Attachment cleanup endpoint', () => {
  it('requires the admin scope', () => {
    const scope = Reflect.getMetadata(REQUIRED_SCOPE_KEY, AttachmentsController.prototype.cleanup);
    assert.equal(scope, 'admin:backup');
    assert.equal(SCOPE_PERMISSIONS.rw.includes(scope), false);
  });
});
