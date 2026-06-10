import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import {
  encrypt,
  decrypt,
  hasEnvelopeMagic,
  parseHeader,
  rewrapEnvelope,
  ENVELOPE_MAGIC,
  ENVELOPE_MAGIC_LEN,
  ENVELOPE_VERSION,
  ENVELOPE_VERSION_V1,
  ALG_AES_256_GCM,
  KDF_NONE,
  WrongKEKError,
  AADPathMismatchError,
  EnvelopeFormatError,
} from './envelope';
import { MemoryKEKSource } from './kek-source';

function freshKEK(): MemoryKEKSource {
  return new MemoryKEKSource(crypto.randomBytes(32));
}

describe('envelope.hasEnvelopeMagic', () => {
  it('detects "KE1\\0" prefix', () => {
    assert.equal(hasEnvelopeMagic(ENVELOPE_MAGIC), true);
    assert.equal(hasEnvelopeMagic(Buffer.concat([ENVELOPE_MAGIC, Buffer.from([0xff])])), true);
  });
  it('returns false for plaintext-looking data', () => {
    assert.equal(hasEnvelopeMagic(Buffer.from('# heading\n')), false);
    assert.equal(hasEnvelopeMagic(Buffer.alloc(0)), false);
    assert.equal(hasEnvelopeMagic(Buffer.from([0x4b, 0x45, 0x31, 0x01])), false); // wrong final byte
  });
});

describe('envelope round-trip', () => {
  it('encrypts and decrypts a small note', async () => {
    const kek = freshKEK();
    const plaintext = Buffer.from('# hello\nworld\n', 'utf8');
    const path = '_users/alice@x.com/foo.md';
    const env = await encrypt(plaintext, path, kek, 'personal');
    assert.ok(hasEnvelopeMagic(env));
    const out = await decrypt(env, path, kek);
    assert.deepEqual(out, plaintext);
  });

  it('encrypts and decrypts zero-byte plaintext', async () => {
    const kek = freshKEK();
    const env = await encrypt(Buffer.alloc(0), 'Notes/empty.md', kek, 'shared');
    const out = await decrypt(env, 'Notes/empty.md', kek);
    assert.deepEqual(out, Buffer.alloc(0));
  });

  it('encrypts and decrypts 1 MB of arbitrary bytes', async () => {
    const kek = freshKEK();
    const plaintext = crypto.randomBytes(1024 * 1024);
    const env = await encrypt(plaintext, '_users/bob/big.bin', kek, 'personal', 'attachment');
    const out = await decrypt(env, '_users/bob/big.bin', kek);
    assert.deepEqual(out, plaintext);
  });

  it('produces different ciphertext for the same plaintext on each call (random IV/CEK)', async () => {
    const kek = freshKEK();
    const plaintext = Buffer.from('repeat me');
    const a = await encrypt(plaintext, 'Notes/x.md', kek, 'shared');
    const b = await encrypt(plaintext, 'Notes/x.md', kek, 'shared');
    assert.notDeepEqual(a, b);
  });
});

describe('envelope security properties', () => {
  it('AAD swap detection: decrypting with a different virtualPath fails', async () => {
    const kek = freshKEK();
    const env = await encrypt(Buffer.from('secret'), '_users/alice/foo.md', kek, 'personal');
    await assert.rejects(
      () => decrypt(env, '_users/alice/bar.md', kek),
      (e: unknown) => e instanceof AADPathMismatchError,
    );
  });

  it('GCM-tag mutation detection: flipping a ciphertext byte fails the tag check', async () => {
    const kek = freshKEK();
    const path = 'Notes/foo.md';
    const env = await encrypt(Buffer.from('hello world'), path, kek, 'shared');
    const mutated = Buffer.from(env);
    // Flip a byte deep in the ciphertext (well after the header).
    mutated[mutated.length - 5] ^= 0x01;
    await assert.rejects(() => decrypt(mutated, path, kek));
  });

  it('GCM-tag mutation detection: flipping the auth tag fails', async () => {
    const kek = freshKEK();
    const path = 'Notes/foo.md';
    const env = await encrypt(Buffer.from('hello world'), path, kek, 'shared');
    const mutated = Buffer.from(env);
    mutated[mutated.length - 1] ^= 0x80;
    await assert.rejects(() => decrypt(mutated, path, kek));
  });

  it('wrong-KEK detection: WrongKEKError exposes both fingerprints', async () => {
    const writerKek = freshKEK();
    const readerKek = freshKEK();
    const path = 'Notes/foo.md';
    const env = await encrypt(Buffer.from('hi'), path, writerKek, 'shared');
    await assert.rejects(
      () => decrypt(env, path, readerKek),
      (e: unknown) => {
        if (!(e instanceof WrongKEKError)) return false;
        const expected = writerKek.fingerprintV2.toString('hex');
        const current = readerKek.fingerprintV2.toString('hex');
        return e.envelopeFingerprint === expected && e.currentFingerprint === current;
      },
    );
  });

  it('parseHeader exposes magic, version, algorithm, KDF, IV, wrappedCek, fingerprint, AAD', async () => {
    const kek = freshKEK();
    const path = '_users/alice/foo.md';
    const env = await encrypt(Buffer.from('hi'), path, kek, 'personal');
    const h = parseHeader(env);
    assert.equal(h.version, ENVELOPE_VERSION);
    assert.equal(h.algorithm, ALG_AES_256_GCM);
    assert.equal(h.kdf, KDF_NONE);
    assert.equal(h.iv.length, 12);
    // v2 envelopes carry a 16-byte fingerprint (raised from v1's 8 bytes to
    // make brute-force infeasible).
    assert.equal(h.kekFingerprint.length, 16);
    assert.deepEqual(h.kekFingerprint, kek.fingerprintV2);
    const aad = JSON.parse(h.aad.toString('utf8'));
    assert.equal(aad.path, path);
    assert.equal(aad.z, 'personal');
    assert.equal(aad.kind, 'note');
    assert.equal(aad.v, 1);
  });

  it('parseHeader rejects buffers without magic', () => {
    assert.throws(
      () => parseHeader(Buffer.from('# plaintext markdown')),
      (e: unknown) => e instanceof EnvelopeFormatError,
    );
  });

  it('parseHeader rejects truncated headers', () => {
    assert.throws(
      () => parseHeader(Buffer.concat([ENVELOPE_MAGIC, Buffer.from([0x01])])),
      (e: unknown) => e instanceof EnvelopeFormatError,
    );
  });
});

describe('envelope v1 backward compatibility', () => {
  // Synthesize a v1-format envelope (8-byte fingerprint) and confirm reads
  // still work after the v2 rollout. Kept as a long-lived guarantee that
  // existing on-disk data does not need a flag day.
  it('decrypts an envelope written with the v1 8-byte fingerprint', async () => {
    const kek = freshKEK();
    const path = '_users/legacy/v1.md';
    const plaintext = Buffer.from('legacy bytes');
    const env = await encrypt(plaintext, path, kek, 'personal');

    // Patch version byte → V1 and truncate the 16-byte fingerprint to 8 bytes
    // in place (everything else is wire-compatible: kdf, kdf_params_len,
    // wrapped_cek_len, aad_len are all the same).
    const header = parseHeader(env);
    const v1Buf = Buffer.alloc(env.length - 8);
    env.copy(v1Buf, 0, 0, ENVELOPE_MAGIC_LEN);
    v1Buf.writeUInt8(ENVELOPE_VERSION_V1, ENVELOPE_MAGIC_LEN);
    // Copy bytes from after the version up to the 16-byte fingerprint start.
    const fpStart = header.bodyOffset - 2 /* aad_len */ - header.aad.length - 16 /* fp */;
    env.copy(v1Buf, ENVELOPE_MAGIC_LEN + 1, ENVELOPE_MAGIC_LEN + 1, fpStart);
    // Write the v1 8-byte fingerprint in place of the v2 16-byte one.
    kek.fingerprint.copy(v1Buf, fpStart);
    // Copy the remainder (aad_len, aad, ciphertext, tag) shifted left by 8.
    env.copy(v1Buf, fpStart + 8, fpStart + 16);

    const reparsed = parseHeader(v1Buf);
    assert.equal(reparsed.version, ENVELOPE_VERSION_V1);
    assert.equal(reparsed.kekFingerprint.length, 8);
    const out = await decrypt(v1Buf, path, kek);
    assert.deepEqual(out, plaintext);
  });
});

describe('envelope.rewrapEnvelope (KEK rotation)', () => {
  it('rewraps a CEK from old KEK to new KEK without touching ciphertext bytes', async () => {
    const oldKek = freshKEK();
    const newKek = freshKEK();
    const path = '_users/alice/foo.md';
    const plaintext = Buffer.from('hello rotation\n', 'utf8');

    const env = await encrypt(plaintext, path, oldKek, 'personal');
    const next = await rewrapEnvelope(env, oldKek, newKek);

    // ciphertext + tag bytes must be byte-identical.
    const oldHeader = parseHeader(env);
    const newHeader = parseHeader(next);
    const oldTail = env.subarray(oldHeader.bodyOffset);
    const newTail = next.subarray(newHeader.bodyOffset);
    assert.deepEqual(oldTail, newTail, 'ciphertext bytes must not move');

    // fingerprint flipped to the new KEK.
    assert.deepEqual(newHeader.kekFingerprint, newKek.fingerprintV2);

    // round-trip with the new KEK still yields the original plaintext.
    const out = await decrypt(next, path, newKek);
    assert.deepEqual(out, plaintext);
  });

  it('is idempotent: returns the same buffer when fingerprint already matches new KEK', async () => {
    const oldKek = freshKEK();
    const newKek = freshKEK();
    const env = await encrypt(Buffer.from('hi'), 'Notes/x.md', newKek, 'shared');
    const next = await rewrapEnvelope(env, oldKek, newKek);
    assert.equal(next, env);
  });

  it('throws WrongKEKError when called with the wrong old KEK', async () => {
    const realOld = freshKEK();
    const wrongOld = freshKEK();
    const newKek = freshKEK();
    const env = await encrypt(Buffer.from('hi'), 'Notes/x.md', realOld, 'shared');
    await assert.rejects(
      () => rewrapEnvelope(env, wrongOld, newKek),
      (e: unknown) => e instanceof WrongKEKError,
    );
  });
});
