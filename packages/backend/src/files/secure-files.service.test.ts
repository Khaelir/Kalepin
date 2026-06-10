import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { FileEntry, FileChangeEvent } from '@kalepin/shared';
import { StorageAdapter } from '../storage/storage-adapter.interface';
import { EncryptingStorageAdapter } from '../storage/encrypting-fs.adapter';
import { MemoryKEKSource } from '../crypto/kek-source';
import { hasEnvelopeMagic, encrypt, ENVELOPE_VERSION, ALG_AES_256_GCM, KDF_ARGON2ID } from '../crypto/envelope';
import { EncryptionPredicates, isE2EPath } from '../crypto/encryption-predicates';
import { SecureFilesService } from './secure-files.service';
import { ShareLinksService } from '../share-links/share-links.service';
import { GrantsService } from '../grants/grants.service';
import { PinService } from '../pin';
import { ShortLink, DocumentGrant } from '../entities';
import { NoteMeta } from '../entities/note-meta.entity';
import { FilesService } from './files.service';

const ALICE = 'alice@example.com';
const ALICE_ROOT = '_users/alice@example.com';
const SRC = `${ALICE_ROOT}/notes/diary.md`;
const DEST = `${ALICE_ROOT}/_secure/diary.md`;

class InMemoryAdapter implements StorageAdapter {
  files = new Map<string, Buffer>();
  async read(p: string): Promise<string> { return (await this.readBytes(p)).toString('utf-8'); }
  async write(p: string, content: string): Promise<void> { return this.writeBytes(p, Buffer.from(content, 'utf-8')); }
  async readBytes(p: string): Promise<Buffer> {
    const v = this.files.get(p);
    if (!v) throw new Error(`ENOENT: ${p}`);
    return v;
  }
  async writeBytes(p: string, content: Buffer): Promise<void> { this.files.set(p, Buffer.from(content)); }
  async writeBytesAtomic(p: string, content: Buffer): Promise<void> { this.files.set(p, Buffer.from(content)); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
  async move(src: string, dest: string): Promise<void> {
    const v = this.files.get(src);
    if (!v) throw new Error(`ENOENT: ${src}`);
    this.files.set(dest, v);
    this.files.delete(src);
  }
  async list(_dir: string): Promise<FileEntry[]> { return []; }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async stat(_p: string): Promise<{ mtime: Date }> { return { mtime: new Date(0) }; }
  watch(_cb: (event: FileChangeEvent) => void): void {}
}

class TestPredicates implements EncryptionPredicates {
  isEncryptedAtRest(path: string): boolean {
    if (this.isE2EEncrypted(path)) return true;
    return path.startsWith('_users/');
  }
  isE2EEncrypted(path: string): boolean { return isE2EPath(path); }
  shouldIndexPlaintext(p: string): boolean { return !this.isE2EEncrypted(p); }
  canCollab(p: string): boolean { return !this.isE2EEncrypted(p); }
  commentBodiesEncrypted(p: string): boolean { return this.isE2EEncrypted(p); }
  shareLinkMintable(p: string): boolean { return !this.isE2EEncrypted(p); }
}

let ds: DataSource;
let inner: InMemoryAdapter;
let kek: MemoryKEKSource;
let predicates: TestPredicates;
let adapter: EncryptingStorageAdapter;
let svc: SecureFilesService;
let grants: GrantsService;
let shareLinks: ShareLinksService;
let pinService: PinService;

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret';

  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [ShortLink, DocumentGrant, NoteMeta],
    synchronize: true,
  });
  await ds.initialize();

  inner = new InMemoryAdapter();
  kek = new MemoryKEKSource(crypto.randomBytes(32));
  predicates = new TestPredicates();
  adapter = new EncryptingStorageAdapter(inner, kek, predicates);

  // Plant the source as an at-rest envelope.
  const env = await encrypt(Buffer.from('top secret'), SRC, kek, 'personal');
  inner.files.set(SRC, env);

  shareLinks = new ShareLinksService(ds.getRepository(ShortLink), adapter as unknown as StorageAdapter, predicates);
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  pinService = new PinService(ds.getRepository(NoteMeta));

  // FilesService is required by the constructor but never called by the
  // service paths under test (we reach storage directly).
  const filesService = {} as FilesService;

  svc = new SecureFilesService(adapter as any, filesService, shareLinks, grants, pinService);
});

afterEach(async () => {
  await ds.destroy();
});

/** Build a v1 envelope with kdf=Argon2id and AAD bound to `path`. */
async function buildE2EEnvelope(path: string, plaintext: string): Promise<Buffer> {
  const cek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(JSON.stringify({ v: 1, path, kind: 'note', z: 'personal' }), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  // fake wrapped CEK — server doesn't unwrap, only validates magic+kdf+aad.
  // Fingerprint width is 16 bytes for v2 envelopes (8 bytes for legacy v1).
  const wrappedCek = Buffer.alloc(40);
  const fingerprint = Buffer.alloc(16);

  const headerFront = Buffer.alloc(4 + 1 + 1 + 1 + 2);
  Buffer.from([0x4b, 0x45, 0x31, 0x00]).copy(headerFront, 0);
  headerFront.writeUInt8(ENVELOPE_VERSION, 4);
  headerFront.writeUInt8(ALG_AES_256_GCM, 5);
  headerFront.writeUInt8(KDF_ARGON2ID, 6);
  headerFront.writeUInt16LE(0, 7);

  const wrappedLenBuf = Buffer.alloc(2);
  wrappedLenBuf.writeUInt16LE(wrappedCek.length, 0);
  const aadLenBuf = Buffer.alloc(2);
  aadLenBuf.writeUInt16LE(aad.length, 0);

  return Buffer.concat([
    headerFront,
    iv,
    wrappedLenBuf,
    wrappedCek,
    fingerprint,
    aadLenBuf,
    aad,
    ciphertext,
    tag,
  ]);
}

describe('SecureFilesService — issueHandoff', () => {
  it('returns plaintext + signed token for the owner', async () => {
    const out = await svc.issueHandoff(SRC, ALICE);
    assert.equal(out.src, SRC);
    assert.equal(out.plaintext, 'top secret');
    assert.equal(typeof out.handoffToken, 'string');
    assert.ok(out.handoffToken.split('.').length === 3, 'handoff token is a JWT');
    assert.ok(out.expiresIn > 0);
  });

  it('rejects a path the user does not own', async () => {
    await assert.rejects(
      () => svc.issueHandoff('_users/bob@example.com/notes/x.md', ALICE),
      /not owned/i,
    );
  });

  it('rejects a _secure/ path (handoff is for move-INTO only)', async () => {
    inner.files.set(DEST, Buffer.from('opaque-bytes'));
    await assert.rejects(
      () => svc.issueHandoff(DEST, ALICE),
      /already in _secure/i,
    );
  });

  it('rejects a non-existent path', async () => {
    await assert.rejects(
      () => svc.issueHandoff(`${ALICE_ROOT}/notes/missing.md`, ALICE),
      /not found/i,
    );
  });
});

describe('SecureFilesService — moveToSecure', () => {
  it('atomically swaps source for E2E envelope and revokes sharing artifacts', async () => {
    // Set up sharing artifacts on the source.
    await grants.mint({ grantorEmail: ALICE, granteeEmail: 'bob@example.com', path: SRC, permission: 'read' });
    await shareLinks.getOrCreate(SRC).catch(() => null);
    await pinService.setPin(SRC, 'abc12345', ALICE);
    assert.equal((await grants.listForGrantor(ALICE)).length, 1);

    const handoff = await svc.issueHandoff(SRC, ALICE);
    const envelope = await buildE2EEnvelope(DEST, handoff.plaintext);

    const out = await svc.moveToSecure({
      src: SRC,
      encryptedEnvelopeBase64: envelope.toString('base64'),
      handoffToken: handoff.handoffToken,
      userEmail: ALICE,
    });

    assert.equal(out.src, SRC);
    assert.equal(out.dest, DEST);
    assert.equal(out.revokedGrants, 1);
    assert.equal(out.pinCleared, true);
    // Source file is gone, dest has the opaque envelope verbatim.
    assert.equal(inner.files.has(SRC), false);
    assert.deepEqual(inner.files.get(DEST), envelope);
    // Grants on src are revoked (none active).
    assert.equal((await grants.listForGrantor(ALICE)).length, 0);
  });

  it('rejects an envelope whose AAD path is not under the user\'s _secure/', async () => {
    const handoff = await svc.issueHandoff(SRC, ALICE);
    // Foreign destination path.
    const envelope = await buildE2EEnvelope('_users/bob@example.com/_secure/diary.md', 'x');
    await assert.rejects(
      () => svc.moveToSecure({
        src: SRC,
        encryptedEnvelopeBase64: envelope.toString('base64'),
        handoffToken: handoff.handoffToken,
        userEmail: ALICE,
      }),
      /not owned/i,
    );
  });

  it('rejects an envelope whose AAD path is not under _secure/', async () => {
    const handoff = await svc.issueHandoff(SRC, ALICE);
    const envelope = await buildE2EEnvelope(`${ALICE_ROOT}/notes/elsewhere.md`, 'x');
    await assert.rejects(
      () => svc.moveToSecure({
        src: SRC,
        encryptedEnvelopeBase64: envelope.toString('base64'),
        handoffToken: handoff.handoffToken,
        userEmail: ALICE,
      }),
      /not under _secure/i,
    );
  });

  it('rejects a tampered or non-envelope payload', async () => {
    const handoff = await svc.issueHandoff(SRC, ALICE);
    await assert.rejects(
      () => svc.moveToSecure({
        src: SRC,
        encryptedEnvelopeBase64: Buffer.from('not an envelope').toString('base64'),
        handoffToken: handoff.handoffToken,
        userEmail: ALICE,
      }),
      /envelope/i,
    );
  });

  it('rejects re-use of an already-redeemed handoff token', async () => {
    const handoff = await svc.issueHandoff(SRC, ALICE);
    const envelope = await buildE2EEnvelope(DEST, handoff.plaintext);
    await svc.moveToSecure({
      src: SRC,
      encryptedEnvelopeBase64: envelope.toString('base64'),
      handoffToken: handoff.handoffToken,
      userEmail: ALICE,
    });
    // Reuse: re-plant a fake source so the path-existence check doesn't short-circuit
    inner.files.set(SRC, Buffer.alloc(8));
    await assert.rejects(
      () => svc.moveToSecure({
        src: SRC,
        encryptedEnvelopeBase64: envelope.toString('base64'),
        handoffToken: handoff.handoffToken,
        userEmail: ALICE,
      }),
      /already used/i,
    );
  });
});

describe('SecureFilesService — moveFromSecure', () => {
  it('writes plaintext at non-_secure dest and deletes _secure source', async () => {
    // Plant an opaque _secure/ envelope at the source.
    inner.files.set(DEST, Buffer.concat([Buffer.from([0x4b, 0x45, 0x31, 0x00]), crypto.randomBytes(64)]));
    const newDest = `${ALICE_ROOT}/notes/restored.md`;
    const out = await svc.moveFromSecure({ src: DEST, dest: newDest, plaintext: 'restored body', userEmail: ALICE });
    assert.equal(out.src, DEST);
    assert.equal(out.dest, newDest);
    assert.equal(inner.files.has(DEST), false);
    // Dest exists; storage adapter at-rest-encrypts personal paths, so it's an envelope.
    assert.equal(hasEnvelopeMagic(inner.files.get(newDest)!), true);
    assert.equal(await adapter.read(newDest), 'restored body');
  });

  it('rejects when src is NOT in _secure/', async () => {
    await assert.rejects(
      () => svc.moveFromSecure({ src: SRC, dest: `${ALICE_ROOT}/notes/foo.md`, plaintext: 'x', userEmail: ALICE }),
      /not under _secure/i,
    );
  });

  it('rejects when dest IS in _secure/', async () => {
    inner.files.set(DEST, Buffer.concat([Buffer.from([0x4b, 0x45, 0x31, 0x00]), crypto.randomBytes(8)]));
    await assert.rejects(
      () => svc.moveFromSecure({ src: DEST, dest: `${ALICE_ROOT}/_secure/other.md`, plaintext: 'x', userEmail: ALICE }),
      /already in _secure/i,
    );
  });

  it('rejects when src is owned by a different user', async () => {
    const foreign = '_users/bob@example.com/_secure/x.md';
    inner.files.set(foreign, Buffer.concat([Buffer.from([0x4b, 0x45, 0x31, 0x00]), crypto.randomBytes(8)]));
    await assert.rejects(
      () => svc.moveFromSecure({ src: foreign, dest: `${ALICE_ROOT}/notes/foo.md`, plaintext: 'x', userEmail: ALICE }),
      /not owned/i,
    );
  });
});
