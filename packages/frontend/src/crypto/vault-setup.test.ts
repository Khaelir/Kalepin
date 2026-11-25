import { describe, it, expect, vi, beforeEach } from 'vitest';

const idbStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idbStore.get(k),
  set: async (k: string, v: unknown) => { idbStore.set(k, v); },
  del: async (k: string) => { idbStore.delete(k); },
}));
vi.mock('../auth', () => ({ getTokenUserId: () => '1' }));

const { createVault } = await import('./vault-setup');
const { cacheMasterKek, loadCachedMasterKek } = await import('./key-store');

// Argon2 is the slow part. Use minimal cost factors for the test.
const fast = { memKiB: 1024, iterations: 1, parallelism: 1 };

async function existingKek() {
  const wrap = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  return { wrap, hmac };
}

const conflict = () => Promise.reject(new Error('Encrypted Folder is already set up'));

describe('createVault', () => {
  beforeEach(() => {
    idbStore.clear();
  });

  it('keeps the new key cached when the server accepts the vault', async () => {
    const save = vi.fn(async () => {});
    const meta = await createVault('hunter22', save, fast);
    expect(save).toHaveBeenCalledWith(meta);
    expect(await loadCachedMasterKek()).toBeDefined();
  });

  it("puts back the existing vault's key when the server refuses the setup", async () => {
    const existing = await existingKek();
    await cacheMasterKek(existing);
    await expect(createVault('hunter22', conflict, fast)).rejects.toThrow(/already set up/);
    const cached = await loadCachedMasterKek();
    expect(cached?.wrap).toBe(existing.wrap);
    expect(cached?.hmac).toBe(existing.hmac);
  });

  it('leaves no key cached when the refused setup had none to restore', async () => {
    await expect(createVault('hunter22', conflict, fast)).rejects.toThrow();
    expect(await loadCachedMasterKek()).toBeUndefined();
  });
});
