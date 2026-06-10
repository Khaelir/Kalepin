import * as crypto from 'crypto';
import type { KEKSource } from './kek-source';

export const ENVELOPE_MAGIC = Buffer.from([0x4b, 0x45, 0x31, 0x00]); // "KE1\0"
export const ENVELOPE_MAGIC_LEN = 4;
/** Legacy 8-byte fingerprint. Read-only; new writes use V2. */
export const ENVELOPE_VERSION_V1 = 0x01;
/** 16-byte fingerprint. 64-bit fingerprints are brute-forceable offline. */
export const ENVELOPE_VERSION_V2 = 0x02;
/** Version emitted by {@link encrypt} for new writes. */
export const ENVELOPE_VERSION = ENVELOPE_VERSION_V2;
export const ALG_AES_256_GCM = 0x01;
export const KDF_NONE = 0x00;
export const KDF_ARGON2ID = 0x01;
export const KDF_HKDF_SHA256 = 0x02;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEK_FP_LEN_V1 = 8;
const KEK_FP_LEN_V2 = 16;

function fpLenForVersion(version: number): number {
  if (version === ENVELOPE_VERSION_V1) return KEK_FP_LEN_V1;
  if (version === ENVELOPE_VERSION_V2) return KEK_FP_LEN_V2;
  throw new EnvelopeFormatError(`unsupported envelope version ${version}`);
}

function kekFingerprintForVersion(kek: KEKSource, version: number): Buffer {
  return version === ENVELOPE_VERSION_V1 ? kek.fingerprint : kek.fingerprintV2;
}

export type EncryptionZone = 'personal' | 'shared';
export type EnvelopeKind = 'note' | 'attachment' | 'meta';

export class WrongKEKError extends Error {
  readonly envelopeFingerprint: string;
  readonly currentFingerprint: string;
  constructor(envelopeFingerprint: Buffer, currentFingerprint: Buffer) {
    const a = envelopeFingerprint.toString('hex');
    const b = currentFingerprint.toString('hex');
    super(`wrong KEK: envelope=${a} current=${b}`);
    this.name = 'WrongKEKError';
    this.envelopeFingerprint = a;
    this.currentFingerprint = b;
  }
}

export class EnvelopeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeFormatError';
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
  kdfParams: Buffer;
  iv: Buffer;
  wrappedCek: Buffer;
  kekFingerprint: Buffer;
  aad: Buffer;
  /** Absolute byte offset in the original buffer where the ciphertext begins. */
  bodyOffset: number;
}

export function hasEnvelopeMagic(buf: Buffer): boolean {
  return (
    buf.length >= ENVELOPE_MAGIC_LEN &&
    buf[0] === ENVELOPE_MAGIC[0] &&
    buf[1] === ENVELOPE_MAGIC[1] &&
    buf[2] === ENVELOPE_MAGIC[2] &&
    buf[3] === ENVELOPE_MAGIC[3]
  );
}

export function parseHeader(buf: Buffer): EnvelopeHeader {
  if (!hasEnvelopeMagic(buf)) {
    throw new EnvelopeFormatError('missing envelope magic');
  }
  let off = ENVELOPE_MAGIC_LEN;
  const need = (n: number) => {
    if (off + n > buf.length) throw new EnvelopeFormatError('truncated envelope header');
  };
  need(1); const version = buf.readUInt8(off); off += 1;
  const fpLen = fpLenForVersion(version);
  need(1); const algorithm = buf.readUInt8(off); off += 1;
  need(1); const kdf = buf.readUInt8(off); off += 1;
  need(2); const kdfParamsLen = buf.readUInt16LE(off); off += 2;
  need(kdfParamsLen);
  const kdfParams = buf.subarray(off, off + kdfParamsLen);
  off += kdfParamsLen;
  need(IV_LEN);
  const iv = buf.subarray(off, off + IV_LEN);
  off += IV_LEN;
  need(2); const wrappedCekLen = buf.readUInt16LE(off); off += 2;
  need(wrappedCekLen);
  const wrappedCek = buf.subarray(off, off + wrappedCekLen);
  off += wrappedCekLen;
  need(fpLen);
  const kekFingerprint = buf.subarray(off, off + fpLen);
  off += fpLen;
  need(2); const aadLen = buf.readUInt16LE(off); off += 2;
  need(aadLen);
  const aad = buf.subarray(off, off + aadLen);
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

export async function encrypt(
  plaintext: Buffer,
  virtualPath: string,
  kek: KEKSource,
  zone: EncryptionZone,
  kind: EnvelopeKind = 'note',
): Promise<Buffer> {
  const cek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(IV_LEN);
  const wrappedCek = await kek.wrap(cek);
  const aad = Buffer.from(
    JSON.stringify({ v: 1, path: virtualPath, kind, z: zone }),
    'utf8',
  );

  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const headerFront = Buffer.alloc(
    ENVELOPE_MAGIC_LEN + 1 /* version */ + 1 /* alg */ + 1 /* kdf */ + 2, /* kdf_params_len */
  );
  ENVELOPE_MAGIC.copy(headerFront, 0);
  headerFront.writeUInt8(ENVELOPE_VERSION, ENVELOPE_MAGIC_LEN);
  headerFront.writeUInt8(ALG_AES_256_GCM, ENVELOPE_MAGIC_LEN + 1);
  headerFront.writeUInt8(KDF_NONE, ENVELOPE_MAGIC_LEN + 2);
  headerFront.writeUInt16LE(0, ENVELOPE_MAGIC_LEN + 3);

  const wrappedLenBuf = Buffer.alloc(2);
  wrappedLenBuf.writeUInt16LE(wrappedCek.length, 0);
  const aadLenBuf = Buffer.alloc(2);
  aadLenBuf.writeUInt16LE(aad.length, 0);

  return Buffer.concat([
    headerFront,
    iv,
    wrappedLenBuf,
    wrappedCek,
    kekFingerprintForVersion(kek, ENVELOPE_VERSION),
    aadLenBuf,
    aad,
    ciphertext,
    tag,
  ]);
}

/**
 * Re-wrap an envelope's CEK from `oldKek` to `newKek` without touching the bulk
 * ciphertext or AAD. Preserves IV, ciphertext, and auth tag. Used by KEK
 * rotation: the small wrapped-CEK header (≈40 B) is swapped, the ciphertext
 * bytes do not move.
 *
 * Idempotent: if the envelope's fingerprint already matches `newKek`, the
 * original buffer is returned unchanged. Re-running rotation after a crash
 * resumes naturally because already-re-wrapped files are skipped.
 *
 * Throws `WrongKEKError` if the envelope was not wrapped by `oldKek`.
 */
export async function rewrapEnvelope(
  buf: Buffer,
  oldKek: KEKSource,
  newKek: KEKSource,
): Promise<Buffer> {
  const header = parseHeader(buf);
  const newFp = kekFingerprintForVersion(newKek, header.version);
  const oldFp = kekFingerprintForVersion(oldKek, header.version);
  if (header.kekFingerprint.equals(newFp)) {
    return buf;
  }
  if (!header.kekFingerprint.equals(oldFp)) {
    throw new WrongKEKError(header.kekFingerprint, oldFp);
  }
  const cek = await oldKek.unwrap(header.wrappedCek);
  const newWrappedCek = await newKek.wrap(cek);

  const headerFront = buf.subarray(
    0,
    ENVELOPE_MAGIC_LEN + 1 /* version */ + 1 /* alg */ + 1 /* kdf */ + 2 /* kdf_params_len */ + header.kdfParams.length + IV_LEN,
  );
  const wrappedLenBuf = Buffer.alloc(2);
  wrappedLenBuf.writeUInt16LE(newWrappedCek.length, 0);
  const aadLenBuf = Buffer.alloc(2);
  aadLenBuf.writeUInt16LE(header.aad.length, 0);
  const tail = buf.subarray(header.bodyOffset);

  return Buffer.concat([
    headerFront,
    wrappedLenBuf,
    newWrappedCek,
    newFp,
    aadLenBuf,
    header.aad,
    tail,
  ]);
}

export async function decrypt(
  buf: Buffer,
  virtualPath: string,
  kek: KEKSource,
): Promise<Buffer> {
  const header = parseHeader(buf);
  const expectedFp = kekFingerprintForVersion(kek, header.version);
  if (!header.kekFingerprint.equals(expectedFp)) {
    throw new WrongKEKError(header.kekFingerprint, expectedFp);
  }
  if (header.algorithm !== ALG_AES_256_GCM) {
    throw new EnvelopeFormatError(`unsupported algorithm ${header.algorithm}`);
  }
  let aadObj: { v?: number; path?: string; kind?: string; z?: string };
  try {
    aadObj = JSON.parse(header.aad.toString('utf8'));
  } catch {
    throw new EnvelopeFormatError('malformed AAD JSON');
  }
  if (typeof aadObj.path !== 'string' || aadObj.path !== virtualPath) {
    throw new AADPathMismatchError(virtualPath, String(aadObj.path));
  }
  if (buf.length < header.bodyOffset + TAG_LEN) {
    throw new EnvelopeFormatError('truncated ciphertext or auth tag');
  }
  const ciphertext = buf.subarray(header.bodyOffset, buf.length - TAG_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);

  const cek = await kek.unwrap(header.wrappedCek);
  const decipher = crypto.createDecipheriv('aes-256-gcm', cek, header.iv);
  decipher.setAAD(header.aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
