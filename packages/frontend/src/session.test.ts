import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const idb = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idb.get(k),
  set: async (k: string, v: unknown) => { idb.set(k, v); },
  del: async (k: string) => { idb.delete(k); },
}));

const { clearSession } = await import('./session');
const { checkTokenFromUrl, getToken, getTokenUserId, setToken } = await import('./auth');
const { cacheMasterKek, loadCachedMasterKek } = await import('./crypto/key-store');

const RECENT = 'kalepin-recent';
const RECOVERY_PENDING = 'e2e-recovery-unlock-pending';

let storage: Map<string, string>;
const originalWindow = (globalThis as { window?: unknown }).window;

function jwt(payload: Record<string, unknown>): string {
  const enc = (v: unknown) =>
    btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

async function nonExtractableKek() {
  const wrap = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  return { wrap, hmac };
}

function stubUrl(search: string) {
  (globalThis as { window?: unknown }).window = {
    location: { pathname: '/', search, hash: '' },
    history: { state: null, replaceState: vi.fn() },
  };
}

beforeEach(() => {
  idb.clear();
  storage = new Map();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); },
    clear: () => { storage.clear(); },
    key: () => null,
    length: 0,
  } as Storage;
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe('clearSession (logout, 401 auto-logout)', () => {
  it("drops the token, recent notes, recovery flag and the unlocked Encrypted Folder key", async () => {
    setToken(jwt({ sub: 1, email: 'alice@example.com' }));
    storage.set(RECENT, JSON.stringify([{ path: '_users/alice@example.com/diary.md', visitedAt: 1 }]));
    storage.set(RECOVERY_PENDING, '1');
    await cacheMasterKek(await nonExtractableKek());
    expect(await loadCachedMasterKek()).toBeDefined();

    await clearSession();

    expect(getToken()).toBeNull();
    expect(storage.has(RECENT)).toBe(false);
    expect(storage.has(RECOVERY_PENDING)).toBe(false);
    expect(idb.size).toBe(0);
    // Signing back in, even as the same user, needs the passphrase again.
    setToken(jwt({ sub: 1, email: 'alice@example.com' }));
    expect(await loadCachedMasterKek()).toBeUndefined();
  });
});

describe('cached key and account switches', () => {
  it("isn't used by another account that signs in without a logout", async () => {
    setToken(jwt({ sub: 1, email: 'alice@example.com' }));
    await cacheMasterKek(await nonExtractableKek());
    setToken(jwt({ sub: 2, email: 'bob@example.com' }));
    expect(await loadCachedMasterKek()).toBeUndefined();
  });
});

describe('getTokenUserId', () => {
  it('reads `sub` from a base64url payload', () => {
    // "?" and "~" encode to "_" / "-" in base64url — plain atob would choke.
    const token = jwt({ sub: 42, email: 'a??~~@example.com' });
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(getTokenUserId(token)).toBe('42');
  });

  it('returns null without a readable token', () => {
    expect(getTokenUserId(null)).toBeNull();
    expect(getTokenUserId('not-a-jwt')).toBeNull();
    expect(getTokenUserId(jwt({ email: 'no-sub@example.com' }))).toBeNull();
  });
});

describe('checkTokenFromUrl', () => {
  it("clears the previous account's recent notes when someone else signs in", () => {
    setToken(jwt({ sub: 1, email: 'alice@example.com' }));
    storage.set(RECENT, JSON.stringify([{ path: '_users/alice@example.com/diary.md', visitedAt: 1 }]));
    storage.set(RECOVERY_PENDING, '1');
    const bob = jwt({ sub: 2, email: 'bob@example.com' });
    stubUrl(`?token=${bob}`);
    expect(checkTokenFromUrl()).toBe(bob);
    expect(storage.has(RECENT)).toBe(false);
    expect(storage.has(RECOVERY_PENDING)).toBe(false);
  });

  it('keeps them when the same user signs in again', () => {
    setToken(jwt({ sub: 1, email: 'alice@example.com' }));
    storage.set(RECENT, '[]');
    stubUrl(`?token=${jwt({ sub: 1, email: 'alice@example.com', iat: 2 })}`);
    checkTokenFromUrl();
    expect(storage.has(RECENT)).toBe(true);
  });
});
