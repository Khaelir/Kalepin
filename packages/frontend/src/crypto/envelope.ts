// Frontend mirror of `packages/backend/src/crypto/envelope.ts`. Wire format
// is byte-compatible: the backend's `parseHeader` must read what we write,
// and our `decrypt` must read what the backend wrote when stage-1 hands a
// ciphertext to the client during a move-into-`_secure/`.
//
// Stage 2 differs from stage 1 only in the `kdf` byte (Argon2id) and the
// 23-byte `kdf_params` payload (passphrase salt + Argon2 cost parameters).
// Per-file CEKs are wrapped against the master-KEK (AES-KW); the master-KEK
// itself is wrapped under a passphrase-derived key out-of-band (see
// `master-kek.ts`).

import type { Argon2Params } from './argon2';
import { encodeArgon2Params, decodeArgon2Params } from './argon2';
import type { MasterKek } from './key-store';

export const ENVELOPE_MAGIC = new Uint8Array([0x4b, 0x45, 0x31, 0x00]); // "KE1\0"
export const ENVELOPE_MAGIC_LEN = 4;
export const ENVELOPE_VERSION = 0x01;
export const ALG_AES_256_GCM = 0x01;
export const KDF_NONE = 0x00;
export const KDF_ARGON2ID = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEK_FP_LEN = 8;
const FINGERPRINT_LABEL = 'kalepin-kek-fp';

export type EnvelopeKind = 'note' | 'attachment' | 'meta';
export type EncryptionZone = 'personal' | 'shared';

export class EnvelopeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeFormatError';
  }
}

export class WrongKEKError extends Error {
  constructor(public readonly envelopeFingerprint: Uint8Array, public readonly currentFingerprint: Uint8Array) {
    super(`wrong KEK: envelope=${toHex(envelopeFingerprint)} current=${toHex(currentFingerprint)}`);
    this.name = 'WrongKEKError';
  }
}

export class AADPathMismatchError extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`AAD path mismatch: expected "${expected}", envelope says "${actual}"`);
    this.name = 'AADPathMismatchError';
  }
}

export interface EnvelopeHeader {
  version: number;
  algorithm: number;
  kdf: number;
  kdfParams: Uint8Array;
  iv: Uint8Array;
  wrappedCek: Uint8Array;
  kekFingerprint: Uint8Array;
  aad: Uint8Array;
  /** Absolute byte offset where the ciphertext begins. */
  bodyOffset: number;
}

export function hasEnvelopeMagic(buf: Uint8Array): boolean {
  return (
    buf.length >= ENVELOPE_MAGIC_LEN &&
    buf[0] === ENVELOPE_MAGIC[0] &&
    buf[1] === ENVELOPE_MAGIC[1] &&
    buf[2] === ENVELOPE_MAGIC[2] &&
    buf[3] === ENVELOPE_MAGIC[3]
  );
}

export function parseHeader(buf: Uint8Array): EnvelopeHeader {
  if (!hasEnvelopeMagic(buf)) {
    throw new EnvelopeFormatError('missing envelope magic');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = ENVELOPE_MAGIC_LEN;
  const need = (n: number) => {
    if (off + n > buf.length) throw new EnvelopeFormatError('truncated envelope header');
  };
  need(1);
  const version = view.getUint8(off); off += 1;
  if (version !== ENVELOPE_VERSION) {
    throw new EnvelopeFormatError(`unsupported envelope version ${version}`);
  }
  need(1);
  const algorithm = view.getUint8(off); off += 1;
  need(1);
  const kdf = view.getUint8(off); off += 1;
  need(2);
  const kdfParamsLen = view.getUint16(off, true); off += 2;
  need(kdfParamsLen);
  const kdfParams = buf.slice(off, off + kdfParamsLen);
  off += kdfParamsLen;
  need(IV_LEN);
  const iv = buf.slice(off, off + IV_LEN);
  off += IV_LEN;
  need(2);
  const wrappedCekLen = view.getUint16(off, true); off += 2;
  need(wrappedCekLen);
  const wrappedCek = buf.slice(off, off + wrappedCekLen);
  off += wrappedCekLen;
  need(KEK_FP_LEN);
  const kekFingerprint = buf.slice(off, off + KEK_FP_LEN);
  off += KEK_FP_LEN;
  need(2);
  const aadLen = view.getUint16(off, true); off += 2;
  need(aadLen);
  const aad = buf.slice(off, off + aadLen);
  off += aadLen;
  return {
    version,
    algorithm,
    kdf,
    kdfParams,
    iv,
    wrappedCek,
    kekFingerprint,
    aad,
    bodyOffset: off,
  };
}

/**
 * `kek_fingerprint = HMAC-SHA256(master-KEK, "kalepin-kek-fp")[:8]`.
 *
 * Stable across passphrase rotations because the master-KEK doesn't rotate.
 * The HMAC handle on `MasterKek` is non-extractable, so we go through
 * WebCrypto's `sign` rather than computing it ourselves.
 */
export async function computeKekFingerprint(masterKek: MasterKek): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign('HMAC', masterKek.hmac, bs(new TextEncoder().encode(FINGERPRINT_LABEL)));
  return new Uint8Array(sig).slice(0, KEK_FP_LEN);
}

// TS 5.x narrows Uint8Array's buffer to ArrayBufferLike (ArrayBuffer |
// SharedArrayBuffer), but WebCrypto wants ArrayBuffer-backed BufferSource.
// All buffers we pass here are freshly allocated, so the narrowing is
// pessimistic — cast at the boundary.
function bs(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

export async function encrypt(
  plaintext: Uint8Array,
  virtualPath: string,
  masterKek: MasterKek,
  argon2Params: Argon2Params,
  passphraseSalt: Uint8Array,
  kind: EnvelopeKind = 'note',
  zone: EncryptionZone = 'personal',
): Promise<Uint8Array> {
  // 1. Generate per-file CEK + IV.
  const cekBytes = crypto.getRandomValues(new Uint8Array(32));
  const cekKey = await crypto.subtle.importKey(
    'raw',
    bs(cekBytes),
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt'],
  );
  const cekForWrap = await crypto.subtle.importKey(
    'raw',
    bs(cekBytes),
    { name: 'AES-GCM', length: 256 },
    /* extractable */ true, // AES-KW wrap requires the wrapped key to be extractable
    ['encrypt'],
  );
  cekBytes.fill(0);

  // 2. AES-KW-wrap CEK with master-KEK.
  const wrappedCekBuf = await crypto.subtle.wrapKey('raw', cekForWrap, masterKek.wrap, 'AES-KW');
  const wrappedCek = new Uint8Array(wrappedCekBuf);

  // 3. AAD binds the path so re-using a ciphertext at a different path fails.
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const aad = new TextEncoder().encode(JSON.stringify({ v: 1, path: virtualPath, kind, z: zone }));

  // 4. Encrypt-then-tag.
  const ctAndTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bs(iv), additionalData: bs(aad), tagLength: TAG_LEN * 8 },
      cekKey,
      bs(plaintext),
    ),
  );
  // 5. Header.
  const fingerprint = await computeKekFingerprint(masterKek);
  const kdfParams = encodeArgon2Params(passphraseSalt, argon2Params);

  const headerLen =
    ENVELOPE_MAGIC_LEN + 1 + 1 + 1 + 2 + kdfParams.length + IV_LEN + 2 + wrappedCek.length + KEK_FP_LEN + 2 + aad.length;
  const out = new Uint8Array(headerLen + ctAndTag.length);
  const outView = new DataView(out.buffer);
  let p = 0;
  out.set(ENVELOPE_MAGIC, p); p += ENVELOPE_MAGIC_LEN;
  outView.setUint8(p, ENVELOPE_VERSION); p += 1;
  outView.setUint8(p, ALG_AES_256_GCM); p += 1;
  outView.setUint8(p, KDF_ARGON2ID); p += 1;
  outView.setUint16(p, kdfParams.length, true); p += 2;
  out.set(kdfParams, p); p += kdfParams.length;
  out.set(iv, p); p += IV_LEN;
  outView.setUint16(p, wrappedCek.length, true); p += 2;
  out.set(wrappedCek, p); p += wrappedCek.length;
  out.set(fingerprint, p); p += KEK_FP_LEN;
  outView.setUint16(p, aad.length, true); p += 2;
  out.set(aad, p); p += aad.length;
  out.set(ctAndTag, p);
  return out;
}

export async function decrypt(
  buf: Uint8Array,
  virtualPath: string,
  masterKek: MasterKek,
): Promise<Uint8Array> {
  const header = parseHeader(buf);
  if (header.algorithm !== ALG_AES_256_GCM) {
    throw new EnvelopeFormatError(`unsupported algorithm ${header.algorithm}`);
  }
  const expectedFp = await computeKekFingerprint(masterKek);
  if (!constantTimeEqual(header.kekFingerprint, expectedFp)) {
    throw new WrongKEKError(header.kekFingerprint, expectedFp);
  }
  let aadObj: { v?: number; path?: string };
  try {
    aadObj = JSON.parse(new TextDecoder().decode(header.aad));
  } catch {
    throw new EnvelopeFormatError('malformed AAD JSON');
  }
  if (typeof aadObj.path !== 'string' || aadObj.path !== virtualPath) {
    throw new AADPathMismatchError(virtualPath, String(aadObj.path));
  }
  if (buf.length < header.bodyOffset + TAG_LEN) {
    throw new EnvelopeFormatError('truncated ciphertext or auth tag');
  }
  const ctAndTag = buf.slice(header.bodyOffset);

  // Unwrap CEK as a non-extractable AES-GCM key.
  const cekKey = await crypto.subtle.unwrapKey(
    'raw',
    bs(header.wrappedCek),
    masterKek.wrap,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['decrypt'],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bs(header.iv), additionalData: bs(header.aad), tagLength: TAG_LEN * 8 },
    cekKey,
    bs(ctAndTag),
  );
  return new Uint8Array(plaintext);
}

export { decodeArgon2Params };

function toHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
