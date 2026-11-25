import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub idb-keyval before importing the module under test so the real package
// (which would touch indexedDB) is never reached.
const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => { store.set(k, v); },
  del: async (k: string) => { store.delete(k); },
}));

// The signed-in user, as read from the session token.
let signedIn: string | null = '1';
vi.mock('../auth', () => ({ getTokenUserId: () => signedIn }));

const { cacheMasterKek, loadCachedMasterKek, clearCachedMasterKek } = await import('./key-store');

describe('key-store', () => {
  beforeEach(() => {
    store.clear();
    signedIn = '1';
  });

  async function genPair(extractable: boolean) {
    const wrap = await crypto.subtle.generateKey(
      { name: 'AES-KW', length: 256 },
      extractable,
      ['wrapKey', 'unwrapKey'],
    );
    const hmac = await crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      extractable,
      ['sign'],
    );
    return { wrap, hmac };
  }

  it('refuses to cache extractable keys', async () => {
    const k = await genPair(true);
    await expect(cacheMasterKek(k)).rejects.toThrow(/extractable/);
  });

  it('round-trips a non-extractable key pair', async () => {
    const k = await genPair(false);
    await cacheMasterKek(k);
    const loaded = await loadCachedMasterKek();
    expect(loaded?.wrap).toBe(k.wrap);
    expect(loaded?.hmac).toBe(k.hmac);
  });

  it('returns undefined on empty store', async () => {
    expect(await loadCachedMasterKek()).toBeUndefined();
  });

  it('clears the cached key', async () => {
    const k = await genPair(false);
    await cacheMasterKek(k);
    await clearCachedMasterKek();
    expect(await loadCachedMasterKek()).toBeUndefined();
  });

  it('wipes corrupted store entries', async () => {
    store.set('e2e-master-kek/v1', { not: 'a key' });
    expect(await loadCachedMasterKek()).toBeUndefined();
    expect(store.has('e2e-master-kek/v1')).toBe(false);
  });

  it("never hands one account's key to another account signed in on the same browser", async () => {
    const k = await genPair(false);
    await cacheMasterKek(k);
    signedIn = '2';
    expect(await loadCachedMasterKek()).toBeUndefined();
    // …and the other account's key is gone, not just hidden.
    signedIn = '1';
    expect(await loadCachedMasterKek()).toBeUndefined();
    expect(store.has('e2e-master-kek/v1')).toBe(false);
  });

  it('wipes a key cached before keys were tied to their user', async () => {
    const k = await genPair(false);
    store.set('e2e-master-kek/v1', { wrap: k.wrap, hmac: k.hmac });
    expect(await loadCachedMasterKek()).toBeUndefined();
    expect(store.has('e2e-master-kek/v1')).toBe(false);
  });

  it('hands out nothing when nobody is signed in', async () => {
    const k = await genPair(false);
    await cacheMasterKek(k);
    signedIn = null;
    expect(await loadCachedMasterKek()).toBeUndefined();
  });

  it('refuses to cache a key without a signed-in user', async () => {
    const k = await genPair(false);
    signedIn = null;
    await expect(cacheMasterKek(k)).rejects.toThrow(/signed-in user/);
    expect(store.size).toBe(0);
  });
});
