// Persistent handle for the unwrapped master-KEK across reloads.
//
// The master-KEK is 256 random bits used for two purposes: AES-KW-wrapping
// per-file CEKs, and HMAC-SHA256-computing the envelope fingerprint. We
// import the raw bytes as TWO CryptoKey handles (AES-KW + HMAC), both
// non-extractable, both pointing at the same underlying secret inside the OS
// WebCrypto implementation.
//
// `CryptoKey` instances are structured-cloneable; IndexedDB persists them
// natively, so we round-trip the live handles (not the bytes). Because both
// keys are `extractable: false`, neither `crypto.subtle.exportKey` nor any
// IDB inspection tool can recover the raw 256 bits.
//
// The entry is shared by everyone using this browser profile, so it records
// whose vault it unlocks (the session JWT's `sub`) and is only handed out to
// that user. Signing out deletes it (see session.ts).

import { get, set, del } from 'idb-keyval';
import { getTokenUserId } from '../auth';

const MASTER_KEK_KEY = 'e2e-master-kek/v1';

export interface MasterKek {
  /** AES-KW handle used to wrap/unwrap per-file CEKs. */
  wrap: CryptoKey;
  /** HMAC-SHA256 handle used to compute envelope `kek_fingerprint`. */
  hmac: CryptoKey;
}

interface CachedMasterKek extends MasterKek {
  /** Id of the user whose vault this key unlocks. */
  owner: string;
}

function isCachedMasterKek(value: unknown): value is CachedMasterKek {
  if (!value || typeof value !== 'object') return false;
  const v = value as { wrap?: unknown; hmac?: unknown; owner?: unknown };
  if (typeof CryptoKey !== 'function') return false;
  return v.wrap instanceof CryptoKey && v.hmac instanceof CryptoKey && typeof v.owner === 'string';
}

export async function loadCachedMasterKek(): Promise<MasterKek | undefined> {
  const value = await get(MASTER_KEK_KEY);
  if (!value) return undefined;
  if (!isCachedMasterKek(value) || value.owner !== getTokenUserId()) {
    // Corruption, an entry from before keys were tied to their user, or
    // another account's key left behind: never hand it out — wipe.
    await del(MASTER_KEK_KEY);
    return undefined;
  }
  return { wrap: value.wrap, hmac: value.hmac };
}

export async function cacheMasterKek(masterKek: MasterKek): Promise<void> {
  if (masterKek.wrap.extractable || masterKek.hmac.extractable) {
    // The lifecycle in master-kek.ts keeps this branch unreachable, but a
    // bug here would silently leak raw key bits. Fail loud instead.
    throw new Error('refusing to cache extractable master-KEK');
  }
  const owner = getTokenUserId();
  if (!owner) throw new Error('refusing to cache master-KEK without a signed-in user');
  const entry: CachedMasterKek = { wrap: masterKek.wrap, hmac: masterKek.hmac, owner };
  await set(MASTER_KEK_KEY, entry);
}

export async function clearCachedMasterKek(): Promise<void> {
  await del(MASTER_KEK_KEY);
}
