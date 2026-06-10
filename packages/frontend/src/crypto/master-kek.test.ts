import { describe, it, expect, vi, beforeEach } from 'vitest';

const idbStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idbStore.get(k),
  set: async (k: string, v: unknown) => { idbStore.set(k, v); },
  del: async (k: string) => { idbStore.delete(k); },
}));

const {
  setupVault,
  unlockWithPassphrase,
  unlockWithRecovery,
  rotatePassphrase,
  regenerateRecovery,
  encodeVaultMetaForWire,
  decodeVaultMetaWire,
} = await import('./master-kek');
const { encrypt, decrypt, computeKekFingerprint } = await import('./envelope');
const { DEFAULT_ARGON2_PARAMS } = await import('./argon2');

// Argon2 is the slow part. Use minimal cost factors for the test.
const fast = { memKiB: 1024, iterations: 1, parallelism: 1 };

describe('master-kek lifecycle', () => {
  beforeEach(() => {
    idbStore.clear();
  });

  it('setup → unlock with same passphrase yields the same master-KEK fingerprint', async () => {
    const { masterKek: mk1, meta } = await setupVault('hunter22', fast);
    const fp1 = await computeKekFingerprint(mk1);

    // Simulate fresh tab: no cached key; unlock from server-stored meta.
    const mk2 = await unlockWithPassphrase('hunter22', meta, fast);
    const fp2 = await computeKekFingerprint(mk2);

    expect(Array.from(fp1)).toEqual(Array.from(fp2));
  }, 20_000);

  it('unlock with wrong passphrase throws', async () => {
    const { meta } = await setupVault('hunter22', fast);
    await expect(unlockWithPassphrase('wrong', meta, fast)).rejects.toThrow();
  }, 20_000);

  it('per-file envelope round-trips after passphrase rotation', async () => {
    const { masterKek, meta } = await setupVault('original', fast);
    const path = '_users/alice/_secure/note.md';
    const plaintext = new TextEncoder().encode('secret content');
    const env = await encrypt(plaintext, path, masterKek, fast, meta.passphrase_salt);

    const rotated = await rotatePassphrase(meta, 'original', 'newpass', fast);
    const newMeta = {
      ...meta,
      passphrase_wrapped_kek: rotated.passphrase_wrapped_kek,
      passphrase_salt: rotated.passphrase_salt,
    };

    // Old passphrase no longer unlocks; new one does.
    await expect(unlockWithPassphrase('original', newMeta, fast)).rejects.toThrow();
    const reUnlocked = await unlockWithPassphrase('newpass', newMeta, fast);

    // Existing envelope still decrypts under the same master-KEK.
    const decoded = await decrypt(env, path, reUnlocked);
    expect(new TextDecoder().decode(decoded)).toBe('secret content');
  }, 30_000);

  it('rotatePassphrase rejects wrong current passphrase', async () => {
    const { meta } = await setupVault('original', fast);
    await expect(rotatePassphrase(meta, 'wrong', 'newpass', fast)).rejects.toThrow();
  }, 20_000);

  it('regenerateRecovery produces a working recovery path', async () => {
    const { masterKek, meta } = await setupVault('hunter22', fast);
    const recoveryBytes = crypto.getRandomValues(new Uint8Array(32));
    const r = await regenerateRecovery(meta, 'hunter22', recoveryBytes, fast);
    const metaWithRecovery = {
      ...meta,
      recovery_wrapped_kek: r.recovery_wrapped_kek,
      recovery_salt: r.recovery_salt,
    };
    const fp1 = await computeKekFingerprint(masterKek);

    const unlocked = await unlockWithRecovery(recoveryBytes, metaWithRecovery, fast);
    const fp2 = await computeKekFingerprint(unlocked);
    expect(Array.from(fp1)).toEqual(Array.from(fp2));
  }, 30_000);

  it('unlockWithRecovery rejects when no recovery configured', async () => {
    const { meta } = await setupVault('hunter22', fast);
    const recoveryBytes = crypto.getRandomValues(new Uint8Array(32));
    await expect(unlockWithRecovery(recoveryBytes, meta, fast)).rejects.toThrow(/no recovery/);
  }, 20_000);

  it('round-trips vault meta through wire encoding', () => {
    const meta = {
      passphrase_wrapped_kek: new Uint8Array([1, 2, 3, 4, 5]),
      passphrase_salt: new Uint8Array([10, 20, 30]),
      recovery_wrapped_kek: new Uint8Array([99]),
      recovery_salt: new Uint8Array([42]),
    };
    const wire = encodeVaultMetaForWire(meta);
    const back = decodeVaultMetaWire(wire);
    expect(back).not.toBeNull();
    expect(Array.from(back!.passphrase_wrapped_kek)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(back!.passphrase_salt)).toEqual([10, 20, 30]);
    expect(Array.from(back!.recovery_wrapped_kek!)).toEqual([99]);
    expect(Array.from(back!.recovery_salt!)).toEqual([42]);
  });

  it('decodeVaultMetaWire returns null when no passphrase blob', () => {
    expect(decodeVaultMetaWire({ passphrase_wrapped_kek: null, passphrase_salt: null })).toBeNull();
  });

  it('uses DEFAULT_ARGON2_PARAMS by default', () => {
    expect(DEFAULT_ARGON2_PARAMS.iterations).toBe(3);
  });
});
