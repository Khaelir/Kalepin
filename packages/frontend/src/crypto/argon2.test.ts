import { describe, it, expect } from 'vitest';
import {
  deriveArgon2,
  encodeArgon2Params,
  decodeArgon2Params,
  DEFAULT_ARGON2_PARAMS,
} from './argon2';

describe('argon2 wrapper', () => {
  it('round-trips kdf_params encoding', () => {
    const salt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) salt[i] = i + 1;
    const encoded = encodeArgon2Params(salt, DEFAULT_ARGON2_PARAMS);
    expect(encoded.length).toBe(23);
    const { salt: roundSalt, params } = decodeArgon2Params(encoded);
    expect(Array.from(roundSalt)).toEqual(Array.from(salt));
    expect(params).toEqual(DEFAULT_ARGON2_PARAMS);
  });

  it('rejects salts that are not 16 bytes', () => {
    expect(() => encodeArgon2Params(new Uint8Array(15), DEFAULT_ARGON2_PARAMS)).toThrow();
    expect(() => decodeArgon2Params(new Uint8Array(22))).toThrow();
  });

  // The WASM derivation is exercised via master-kek tests; here we just
  // assert deterministic output for a fixed input under low-cost parameters
  // so the test stays under a second.
  it('derives deterministic 32 bytes', async () => {
    const salt = new Uint8Array(16);
    salt.fill(0xab);
    const fastParams = { memKiB: 1024, iterations: 1, parallelism: 1 };
    const a = await deriveArgon2('hunter2', salt, fastParams);
    const b = await deriveArgon2('hunter2', salt, fastParams);
    expect(a.length).toBe(32);
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = await deriveArgon2('hunter3', salt, fastParams);
    expect(Array.from(a)).not.toEqual(Array.from(c));
  }, 15_000);
});
