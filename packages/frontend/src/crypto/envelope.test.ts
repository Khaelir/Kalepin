import { describe, it, expect } from 'vitest';
import {
  hasEnvelopeMagic,
  parseHeader,
  encrypt,
  decrypt,
  computeKekFingerprint,
  KDF_ARGON2ID,
  ALG_AES_256_GCM,
  ENVELOPE_VERSION,
  AADPathMismatchError,
  WrongKEKError,
  EnvelopeFormatError,
} from './envelope';
import { DEFAULT_ARGON2_PARAMS } from './argon2';
import type { MasterKek } from './key-store';

async function makeMasterKek(): Promise<MasterKek> {
  // Generate raw 32 bytes once, import twice with different algorithms so
  // both handles point at the same secret. This mirrors what master-kek.ts
  // does at vault setup time.
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const wrap = await crypto.subtle.importKey('raw', raw, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  const hmac = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  raw.fill(0);
  return { wrap, hmac };
}

describe('envelope codec', () => {
  it('encrypts and decrypts the same plaintext', async () => {
    const kek = await makeMasterKek();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const path = '_users/alice@x/_secure/journal.md';
    const plaintext = new TextEncoder().encode('hello world');

    const env = await encrypt(plaintext, path, kek, DEFAULT_ARGON2_PARAMS, salt);

    expect(hasEnvelopeMagic(env)).toBe(true);
    const header = parseHeader(env);
    expect(header.version).toBe(ENVELOPE_VERSION);
    expect(header.algorithm).toBe(ALG_AES_256_GCM);
    expect(header.kdf).toBe(KDF_ARGON2ID);
    expect(header.kdfParams.length).toBe(23);
    expect(header.iv.length).toBe(12);
    expect(header.kekFingerprint.length).toBe(8);

    const fp = await computeKekFingerprint(kek);
    expect(Array.from(header.kekFingerprint)).toEqual(Array.from(fp));

    const decoded = await decrypt(env, path, kek);
    expect(new TextDecoder().decode(decoded)).toBe('hello world');
  });

  it('rejects wrong KEK', async () => {
    const kekA = await makeMasterKek();
    const kekB = await makeMasterKek();
    const salt = new Uint8Array(16);
    const path = '_users/alice/_secure/foo.md';
    const env = await encrypt(new Uint8Array([1, 2, 3]), path, kekA, DEFAULT_ARGON2_PARAMS, salt);
    await expect(decrypt(env, path, kekB)).rejects.toThrow(WrongKEKError);
  });

  it('rejects AAD path mismatch', async () => {
    const kek = await makeMasterKek();
    const salt = new Uint8Array(16);
    const env = await encrypt(new Uint8Array([1, 2, 3]), '_users/alice/_secure/a.md', kek, DEFAULT_ARGON2_PARAMS, salt);
    await expect(decrypt(env, '_users/alice/_secure/b.md', kek)).rejects.toThrow(AADPathMismatchError);
  });

  it('detects truncated headers', () => {
    expect(() => parseHeader(new Uint8Array([0x4b, 0x45, 0x31, 0x00]))).toThrow(EnvelopeFormatError);
  });

  it('rejects bytes without magic', () => {
    expect(hasEnvelopeMagic(new Uint8Array([0, 0, 0, 0]))).toBe(false);
    expect(() => parseHeader(new Uint8Array([0, 0, 0, 0]))).toThrow(EnvelopeFormatError);
  });

  it('preserves binary content (e.g., images)', async () => {
    const kek = await makeMasterKek();
    const salt = new Uint8Array(16);
    const path = '_users/alice/_secure/_attachments/img.png';
    const bytes = new Uint8Array(1024);
    crypto.getRandomValues(bytes);
    const env = await encrypt(bytes, path, kek, DEFAULT_ARGON2_PARAMS, salt, 'attachment');
    const back = await decrypt(env, path, kek);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });
});
