import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AttachmentsService } from './attachments.service';

let tmpRoot: string;
let vaultPath: string;
let personalPath: string;
let service: AttachmentsService;

function makeFile(buffer: Buffer, originalname: string, mimetype: string): Express.Multer.File {
  return {
    buffer,
    originalname,
    mimetype,
    size: buffer.length,
    fieldname: 'file',
    encoding: '7bit',
    stream: null as any,
    destination: '',
    filename: '',
    path: '',
  };
}

async function setup() {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-att-personal-'));
  vaultPath = path.join(tmpRoot, 'vault');
  personalPath = path.join(tmpRoot, 'personal');
  await fs.mkdir(vaultPath, { recursive: true });
  await fs.mkdir(personalPath, { recursive: true });
  process.env.VAULT_PATH = vaultPath;
  process.env.PERSONAL_PATH = personalPath;
  service = new AttachmentsService();
}

async function cleanup() {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  delete process.env.VAULT_PATH;
  delete process.env.PERSONAL_PATH;
}

describe('AttachmentsService — namespace routing on upload', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('routes uploads from a shared note to the shared dir (legacy URL shape)', async () => {
    const file = makeFile(Buffer.from('shared-img'), 'a.png', 'image/png');
    const result = await service.upload(file, 'Notes/foo.md', 'alice@example.com');

    assert.equal(result.doc, undefined, 'shared upload should not include doc hint');

    const sharedDir = path.join(vaultPath, '_attachments');
    const personalDir = path.join(personalPath, 'alice@example.com', '_attachments');
    const sharedExists = await fs.stat(path.join(sharedDir, result.name)).then(() => true).catch(() => false);
    const personalExists = await fs.stat(path.join(personalDir, result.name)).then(() => true).catch(() => false);
    assert.equal(sharedExists, true);
    assert.equal(personalExists, false);
  });

  it('routes uploads from inside a personal note to the per-user attachment dir', async () => {
    const file = makeFile(Buffer.from('personal-img'), 'd.png', 'image/png');
    const result = await service.upload(
      file,
      '_users/alice@example.com/diary.md',
      'alice@example.com',
    );

    assert.equal(result.doc, '_users/alice@example.com/diary.md');

    const personalDir = path.join(personalPath, 'alice@example.com', '_attachments');
    const exists = await fs.stat(path.join(personalDir, result.name)).then(() => true).catch(() => false);
    assert.equal(exists, true);
  });

  it("falls back to shared when docPath is under another user's _users root", async () => {
    // Bob uploads while pretending docPath is Alice's — the routing falls back to shared
    // (the controller layer would have rejected via assertWritableBy, but the service is
    //  defensive: it never writes into another user's namespace just because docPath says so).
    const file = makeFile(Buffer.from('hostile'), 'x.png', 'image/png');
    const result = await service.upload(
      file,
      '_users/alice@example.com/secret.md',
      'bob@example.com',
    );
    assert.equal(result.doc, undefined);

    const sharedDir = path.join(vaultPath, '_attachments');
    const aliceDir = path.join(personalPath, 'alice@example.com', '_attachments');
    const inShared = await fs.stat(path.join(sharedDir, result.name)).then(() => true).catch(() => false);
    const inAlice = await fs.stat(path.join(aliceDir, result.name)).then(() => true).catch(() => false);
    assert.equal(inShared, true);
    assert.equal(inAlice, false, 'must not write into another user\'s namespace');
  });
});

describe('AttachmentsService — serve gating', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('legacy ?name=X (no doc) keeps serving from shared', async () => {
    const dir = path.join(vaultPath, '_attachments');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'legacy.png'), Buffer.from('img'));

    const result = await service.serve('legacy.png');
    assert.equal(result.contentType, 'image/png');
    assert.deepEqual(result.buffer, Buffer.from('img'));
  });

  it('personal happy path: owner serves from personal namespace', async () => {
    const aliceDir = path.join(personalPath, 'alice@example.com', '_attachments');
    await fs.mkdir(aliceDir, { recursive: true });
    await fs.writeFile(path.join(aliceDir, 'ATTACHTOK.png'), Buffer.from('personal-bytes'));

    const result = await service.serve(
      'ATTACHTOK.png',
      '_users/alice@example.com/diary.md',
      'alice@example.com',
    );
    assert.deepEqual(result.buffer, Buffer.from('personal-bytes'));
  });

  it('namespace spoofing: bob crafting Alice\'s doc gets 404 at predicate, never touches FS', async () => {
    // File exists in Alice's namespace
    const aliceDir = path.join(personalPath, 'alice@example.com', '_attachments');
    await fs.mkdir(aliceDir, { recursive: true });
    await fs.writeFile(path.join(aliceDir, 'ATTACHTOK.png'), Buffer.from('alice-bytes'));

    await assert.rejects(
      () => service.serve('ATTACHTOK.png', '_users/alice@example.com/diary.md', 'bob@example.com'),
      { name: 'NotFoundException' },
    );
  });

  it('LIKE-injection variant: john_doe uploads, johnxdoe cannot read with crafted doc', async () => {
    // Alice uses email john_doe@x.com. Her real personal _attachments contains the file.
    const aliceDir = path.join(personalPath, 'john_doe@x.com', '_attachments');
    await fs.mkdir(aliceDir, { recursive: true });
    await fs.writeFile(path.join(aliceDir, 'ATTACHTOK.png'), Buffer.from('alice-john_doe'));

    // Bob is johnxdoe@x.com — exact-string compare in assertReadableBy must keep him out.
    await assert.rejects(
      () => service.serve(
        'ATTACHTOK.png',
        '_users/john_doe@x.com/diary.md',
        'johnxdoe@x.com',
      ),
      { name: 'NotFoundException' },
    );
  });

  it('serve without doc never resolves a personal-namespace file', async () => {
    const aliceDir = path.join(personalPath, 'alice@example.com', '_attachments');
    await fs.mkdir(aliceDir, { recursive: true });
    await fs.writeFile(path.join(aliceDir, 'private.png'), Buffer.from('private-bytes'));

    // Without a doc hint, serve falls back to shared; even Alice gets 404 here.
    await assert.rejects(
      () => service.serve('private.png', undefined, 'alice@example.com'),
      { name: 'NotFoundException' },
    );
  });
});

describe('AttachmentsService — copyBetweenNamespaces', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('copies an attachment from shared to a personal namespace (promote)', async () => {
    const sharedDir = path.join(vaultPath, '_attachments');
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(path.join(sharedDir, 'X.png'), Buffer.from('content'));

    await service.copyBetweenNamespaces(
      'X.png',
      { kind: 'shared' },
      { kind: 'personal', email: 'alice@example.com' },
    );

    const aliceFile = path.join(personalPath, 'alice@example.com', '_attachments', 'X.png');
    const bytes = await fs.readFile(aliceFile);
    assert.deepEqual(bytes, Buffer.from('content'));

    // Source-side copy still present (cleanup sweeper's job to reap)
    const stillThere = await fs.stat(path.join(sharedDir, 'X.png')).then(() => true).catch(() => false);
    assert.equal(stillThere, true);
  });

  it('idempotent: re-copying does not error', async () => {
    const sharedDir = path.join(vaultPath, '_attachments');
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(path.join(sharedDir, 'Y.png'), Buffer.from('first'));

    await service.copyBetweenNamespaces(
      'Y.png',
      { kind: 'shared' },
      { kind: 'personal', email: 'alice@example.com' },
    );
    // Second call must not overwrite or throw
    await service.copyBetweenNamespaces(
      'Y.png',
      { kind: 'shared' },
      { kind: 'personal', email: 'alice@example.com' },
    );
    const bytes = await fs.readFile(path.join(personalPath, 'alice@example.com', '_attachments', 'Y.png'));
    assert.deepEqual(bytes, Buffer.from('first'));
  });
});

describe('AttachmentsService — cleanup walks both roots', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('reaps orphan in shared and orphan in personal independently', async () => {
    const sharedDir = path.join(vaultPath, '_attachments');
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(path.join(sharedDir, 'shared-orphan.png'), 'img');
    await fs.writeFile(path.join(vaultPath, 'doc.md'), 'no refs here');

    const aliceRoot = path.join(personalPath, 'alice@example.com');
    const aliceAtt = path.join(aliceRoot, '_attachments');
    await fs.mkdir(aliceAtt, { recursive: true });
    await fs.writeFile(path.join(aliceAtt, 'alice-orphan.png'), 'img');
    await fs.writeFile(path.join(aliceAtt, 'alice-used.png'), 'img');
    await fs.writeFile(path.join(aliceRoot, 'diary.md'), '![](_attachments/alice-used.png)');

    const result = await service.cleanup();
    assert.equal(result.orphansFound, 2);

    // Survivors
    const aliceUsedExists = await fs.stat(path.join(aliceAtt, 'alice-used.png'))
      .then(() => true).catch(() => false);
    assert.equal(aliceUsedExists, true);

    // Each namespace has its own .trash/
    const sharedTrash = await fs.readdir(path.join(sharedDir, '.trash'));
    const aliceTrash = await fs.readdir(path.join(aliceAtt, '.trash'));
    assert.equal(sharedTrash.length, 1);
    assert.equal(aliceTrash.length, 1);
    assert.ok(sharedTrash[0].endsWith('_shared-orphan.png'));
    assert.ok(aliceTrash[0].endsWith('_alice-orphan.png'));
  });

  it('does not save a personal orphan because a shared note references the same name', async () => {
    const sharedDir = path.join(vaultPath, '_attachments');
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(path.join(sharedDir, 'X.png'), 'img');
    await fs.writeFile(path.join(vaultPath, 'doc.md'), '![](_attachments/X.png)');

    const aliceRoot = path.join(personalPath, 'alice@example.com');
    const aliceAtt = path.join(aliceRoot, '_attachments');
    await fs.mkdir(aliceAtt, { recursive: true });
    await fs.writeFile(path.join(aliceAtt, 'X.png'), 'img-alice'); // orphan in Alice's NS
    await fs.writeFile(path.join(aliceRoot, 'diary.md'), 'no refs');

    const result = await service.cleanup();
    assert.equal(result.orphansFound, 1);

    const stillInShared = await fs.stat(path.join(sharedDir, 'X.png')).then(() => true).catch(() => false);
    assert.equal(stillInShared, true, 'shared X.png is referenced and must survive');
    const stillInAlice = await fs.stat(path.join(aliceAtt, 'X.png')).then(() => true).catch(() => false);
    assert.equal(stillInAlice, false, 'Alice\'s orphan must be reaped despite same name in shared');
  });
});
