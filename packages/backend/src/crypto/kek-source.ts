import * as crypto from 'crypto';
import * as fs from 'fs';

const AESKW_DEFAULT_IV = Buffer.from([0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6]);
const FINGERPRINT_LABEL = 'kalepin-kek-fp';
export const KEK_LENGTH_BYTES = 32;
/**
 * Legacy fingerprint width used by envelope v1. 64 bits is brute-forceable,
 * so v2 envelopes use 128 bits — see {@link KEK_FINGERPRINT_BYTES_V2}. The
 * v1 width is kept for backward-compatible reads of envelopes written before
 * the v2 rollout.
 */
export const KEK_FINGERPRINT_BYTES = 8;
export const KEK_FINGERPRINT_BYTES_V2 = 16;
export const KEK_SOURCE = 'KEK_SOURCE';

export interface KEKSource {
  /** 8-byte fingerprint used by envelope v1. v1 is read-only post-v2 rollout. */
  readonly fingerprint: Buffer;
  /** 16-byte fingerprint emitted by envelope v2. */
  readonly fingerprintV2: Buffer;
  wrap(cek: Buffer): Promise<Buffer>;
  unwrap(wrappedCek: Buffer): Promise<Buffer>;
}

export function computeKEKFingerprint(kek: Buffer, len: number = KEK_FINGERPRINT_BYTES): Buffer {
  return crypto
    .createHmac('sha256', kek)
    .update(FINGERPRINT_LABEL)
    .digest()
    .subarray(0, len);
}

abstract class AesKwKEKSource implements KEKSource {
  readonly fingerprint: Buffer;
  readonly fingerprintV2: Buffer;

  protected constructor(private readonly kekBytes: Buffer) {
    if (kekBytes.length !== KEK_LENGTH_BYTES) {
      throw new Error(
        `KEK must be exactly ${KEK_LENGTH_BYTES} bytes, got ${kekBytes.length}`,
      );
    }
    this.fingerprint = computeKEKFingerprint(kekBytes, KEK_FINGERPRINT_BYTES);
    this.fingerprintV2 = computeKEKFingerprint(kekBytes, KEK_FINGERPRINT_BYTES_V2);
  }

  async wrap(cek: Buffer): Promise<Buffer> {
    const cipher = crypto.createCipheriv('aes256-wrap', this.kekBytes, AESKW_DEFAULT_IV);
    return Buffer.concat([cipher.update(cek), cipher.final()]);
  }

  async unwrap(wrappedCek: Buffer): Promise<Buffer> {
    const decipher = crypto.createDecipheriv('aes256-wrap', this.kekBytes, AESKW_DEFAULT_IV);
    return Buffer.concat([decipher.update(wrappedCek), decipher.final()]);
  }
}

export class FileKEKSource extends AesKwKEKSource {
  constructor(public readonly path: string) {
    super(FileKEKSource.loadAndValidate(path));
  }

  private static loadAndValidate(p: string): Buffer {
    const stat = fs.statSync(p);
    if (!stat.isFile()) throw new Error(`KEK path is not a regular file: ${p}`);
    const mode = stat.mode & 0o777;
    if (mode !== 0o400 && mode !== 0o600) {
      throw new Error(
        `KEK file ${p} mode ${mode.toString(8).padStart(4, '0')} is too permissive; require 0400 or 0600`,
      );
    }
    return fs.readFileSync(p);
  }
}

export class EnvKEKSource extends AesKwKEKSource {
  constructor() {
    super(EnvKEKSource.loadAndValidate());
  }

  private static loadAndValidate(): Buffer {
    if (process.env.NODE_ENV === 'production' && !process.env.KALEPIN_KEK_FILE) {
      throw new Error(
        'EnvKEKSource refuses to start in production; configure KALEPIN_KEK_FILE for FileKEKSource',
      );
    }
    const hex = process.env.KALEPIN_KEK;
    if (!hex) throw new Error('KALEPIN_KEK env var is not set');
    const trimmed = hex.trim();
    if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
      throw new Error('KALEPIN_KEK must be hex-encoded');
    }
    const bytes = Buffer.from(trimmed, 'hex');
    if (bytes.length !== KEK_LENGTH_BYTES) {
      throw new Error(
        `KALEPIN_KEK must decode to ${KEK_LENGTH_BYTES} bytes, got ${bytes.length}`,
      );
    }
    return bytes;
  }
}

/**
 * In-memory KEK source for tests, KEK rotation, and one-shot tooling.
 * The 32-byte secret is held in process memory only.
 */
export class MemoryKEKSource extends AesKwKEKSource {
  constructor(bytes: Buffer) {
    super(bytes);
  }
}

/**
 * Sentinel KEK source for end-to-end encrypted paths. The server has no key
 * material; wrap/unwrap are not authoritative. The encrypting storage adapter
 * detects this source by `instanceof` and short-circuits read/write to a
 * passthrough — the client wraps and unwraps on its side. The fingerprint is a
 * fixed all-zero buffer so any code that reads it sees a stable sentinel.
 */
export class ClientKEKSource implements KEKSource {
  readonly fingerprint = Buffer.alloc(KEK_FINGERPRINT_BYTES);
  readonly fingerprintV2 = Buffer.alloc(KEK_FINGERPRINT_BYTES_V2);

  async wrap(_cek: Buffer): Promise<Buffer> {
    throw new Error('ClientKEKSource is not authoritative — client must wrap');
  }

  async unwrap(_wrappedCek: Buffer): Promise<Buffer> {
    throw new Error('ClientKEKSource is not authoritative — client must unwrap');
  }
}
