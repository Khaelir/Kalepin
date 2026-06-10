// Vault setup, unlock, and rotation flows.
//
// The master-KEK is 256 random bits, generated once per vault, never derived
// from the passphrase. Two short-lived wrappings of the master-KEK live on
// the server (`passphrase_wrapped_kek` and the optional
// `recovery_wrapped_kek`); both are AES-KW blobs the server treats as
// opaque. Per-file CEKs reference the master-KEK directly, so passphrase
// rotation re-wraps a single 40-byte blob and leaves every envelope on disk
// untouched.
//
// The "raw 32 bytes briefly in JS" window is unavoidable: WebCrypto needs
// raw input to bind the same secret to two algorithms (AES-KW for
// CEK-wrapping, HMAC-SHA256 for the fingerprint). We zero the buffer the
// moment both imports complete.

import { deriveArgon2, DEFAULT_ARGON2_PARAMS, type Argon2Params } from './argon2';
import { cacheMasterKek, type MasterKek } from './key-store';

const KEK_BYTE_LEN = 32;
const SALT_BYTE_LEN = 16;

/** Server-stored vault metadata. All fields are opaque bytes the server can't read. */
export interface VaultMeta {
  passphrase_wrapped_kek: Uint8Array;
  passphrase_salt: Uint8Array;
  recovery_wrapped_kek?: Uint8Array;
  recovery_salt?: Uint8Array;
}

/** Encoded vault meta over the wire (base64 strings). */
export interface VaultMetaWire {
  passphrase_wrapped_kek: string | null;
  passphrase_salt: string | null;
  recovery_wrapped_kek?: string | null;
  recovery_salt?: string | null;
}

export function decodeVaultMetaWire(wire: VaultMetaWire): VaultMeta | null {
  if (!wire.passphrase_wrapped_kek || !wire.passphrase_salt) return null;
  return {
    passphrase_wrapped_kek: base64ToBytes(wire.passphrase_wrapped_kek),
    passphrase_salt: base64ToBytes(wire.passphrase_salt),
    recovery_wrapped_kek: wire.recovery_wrapped_kek ? base64ToBytes(wire.recovery_wrapped_kek) : undefined,
    recovery_salt: wire.recovery_salt ? base64ToBytes(wire.recovery_salt) : undefined,
  };
}

export function encodeVaultMetaForWire(meta: Partial<VaultMeta>): VaultMetaWire {
  return {
    passphrase_wrapped_kek: meta.passphrase_wrapped_kek ? bytesToBase64(meta.passphrase_wrapped_kek) : null,
    passphrase_salt: meta.passphrase_salt ? bytesToBase64(meta.passphrase_salt) : null,
    recovery_wrapped_kek: meta.recovery_wrapped_kek ? bytesToBase64(meta.recovery_wrapped_kek) : undefined,
    recovery_salt: meta.recovery_salt ? bytesToBase64(meta.recovery_salt) : undefined,
  };
}

/**
 * First-time vault creation. Generates the master-KEK, wraps it under the
 * passphrase-derived KEK, returns the wrapped blob + salt the caller PUTs
 * to `/api/users/me/vault-meta`. Caches the live MasterKek in IndexedDB so
 * subsequent reads in the same session don't re-prompt.
 */
export async function setupVault(
  passphrase: string,
  argon2Params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<{ masterKek: MasterKek; meta: VaultMeta }> {
  const passphraseSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LEN));
  const passphraseKek = await derivePassphraseKek(passphrase, passphraseSalt, argon2Params);

  const rawMasterKek = crypto.getRandomValues(new Uint8Array(KEK_BYTE_LEN));
  try {
    const wrappedBlob = await wrapMasterKek(rawMasterKek, passphraseKek);
    const masterKek = await importMasterKek(rawMasterKek);
    await cacheMasterKek(masterKek);
    return {
      masterKek,
      meta: { passphrase_wrapped_kek: wrappedBlob, passphrase_salt: passphraseSalt },
    };
  } finally {
    rawMasterKek.fill(0);
  }
}

export async function unlockWithPassphrase(
  passphrase: string,
  meta: VaultMeta,
  argon2Params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<MasterKek> {
  const passphraseKek = await derivePassphraseKek(passphrase, meta.passphrase_salt, argon2Params);
  const rawMasterKek = await unwrapMasterKekRaw(meta.passphrase_wrapped_kek, passphraseKek);
  try {
    const masterKek = await importMasterKek(rawMasterKek);
    await cacheMasterKek(masterKek);
    return masterKek;
  } finally {
    rawMasterKek.fill(0);
  }
}

export async function unlockWithRecovery(
  recoveryBytes: Uint8Array,
  meta: VaultMeta,
  argon2Params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<MasterKek> {
  if (!meta.recovery_wrapped_kek || !meta.recovery_salt) {
    throw new Error('no recovery configured');
  }
  const recoveryKek = await derivePassphraseKek(recoveryBytes, meta.recovery_salt, argon2Params);
  const rawMasterKek = await unwrapMasterKekRaw(meta.recovery_wrapped_kek, recoveryKek);
  try {
    const masterKek = await importMasterKek(rawMasterKek);
    await cacheMasterKek(masterKek);
    return masterKek;
  } finally {
    rawMasterKek.fill(0);
  }
}

/**
 * Routine passphrase change. The user enters their current passphrase
 * (re-auth gate); we re-derive the unlock path to obtain the master-KEK
 * raw bytes, then wrap them under a fresh passphrase-KEK. Per-file
 * envelopes are untouched: the master-KEK and its fingerprint are
 * unchanged.
 *
 * The current-passphrase requirement is dual-purpose:
 *   1. WebCrypto refuses `wrapKey('raw', …)` on a non-extractable key, so
 *      we must re-derive the bytes from the wrapped blob.
 *   2. Re-auth before a sensitive change matches the threat model — a
 *      stolen unlocked tab can't silently rotate someone out.
 */
export async function rotatePassphrase(
  meta: VaultMeta,
  currentPassphrase: string,
  newPassphrase: string,
  argon2Params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<{ passphrase_wrapped_kek: Uint8Array; passphrase_salt: Uint8Array }> {
  const currentPassphraseKek = await derivePassphraseKek(currentPassphrase, meta.passphrase_salt, argon2Params);
  const rawMasterKek = await unwrapMasterKekRaw(meta.passphrase_wrapped_kek, currentPassphraseKek);
  try {
    const newSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LEN));
    const newPassphraseKek = await derivePassphraseKek(newPassphrase, newSalt, argon2Params);
    const wrapped = await wrapMasterKek(rawMasterKek, newPassphraseKek);
    return { passphrase_wrapped_kek: wrapped, passphrase_salt: newSalt };
  } finally {
    rawMasterKek.fill(0);
  }
}

/**
 * Generate a fresh recovery-KEK and re-wrap the master-KEK under it. Same
 * re-derive-from-current-passphrase pattern as rotatePassphrase. Caller
 * does the BIP-39 phrase generation and shows it to the user.
 *
 * Special case: if the user is in the `recoveryUnlockPending` state (just
 * unlocked via recovery and hasn't set a new passphrase yet), pass the
 * recovery phrase as `currentPassphrase` and set `viaRecovery=true`.
 */
export async function regenerateRecovery(
  meta: VaultMeta,
  currentPassphrase: string,
  newRecoveryBytes: Uint8Array,
  argon2Params: Argon2Params = DEFAULT_ARGON2_PARAMS,
  viaRecovery: boolean = false,
): Promise<{ recovery_wrapped_kek: Uint8Array; recovery_salt: Uint8Array }> {
  const wrappedSource = viaRecovery ? meta.recovery_wrapped_kek : meta.passphrase_wrapped_kek;
  const saltSource = viaRecovery ? meta.recovery_salt : meta.passphrase_salt;
  if (!wrappedSource || !saltSource) {
    throw new Error(viaRecovery ? 'no recovery wrapping available' : 'vault meta incomplete');
  }
  const unlockKek = await derivePassphraseKek(currentPassphrase, saltSource, argon2Params);
  const rawMasterKek = await unwrapMasterKekRaw(wrappedSource, unlockKek);
  try {
    const recoverySalt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LEN));
    const recoveryKek = await derivePassphraseKek(newRecoveryBytes, recoverySalt, argon2Params);
    const wrapped = await wrapMasterKek(rawMasterKek, recoveryKek);
    return { recovery_wrapped_kek: wrapped, recovery_salt: recoverySalt };
  } finally {
    rawMasterKek.fill(0);
  }
}

// ─── internals ────────────────────────────────────────────────────────────

// TS 5.x narrows Uint8Array to ArrayBufferLike (covers SharedArrayBuffer);
// WebCrypto wants ArrayBuffer-backed BufferSource. Our buffers are always
// freshly allocated, so cast at the boundary.
function bs(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

async function derivePassphraseKek(
  passphrase: string | Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<CryptoKey> {
  const bytes = await deriveArgon2(passphrase, salt, params);
  try {
    return await crypto.subtle.importKey(
      'raw', bs(bytes), { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey'],
    );
  } finally {
    bytes.fill(0);
  }
}

async function wrapMasterKek(rawMasterKek: Uint8Array, wrappingKek: CryptoKey): Promise<Uint8Array> {
  const tmp = await crypto.subtle.importKey(
    'raw', bs(rawMasterKek), { name: 'AES-KW', length: 256 }, /* extractable */ true, ['wrapKey'],
  );
  const wrapped = await crypto.subtle.wrapKey('raw', tmp, wrappingKek, 'AES-KW');
  return new Uint8Array(wrapped);
}

async function unwrapMasterKekRaw(wrapped: Uint8Array, unwrappingKek: CryptoKey): Promise<Uint8Array> {
  const tmp = await crypto.subtle.unwrapKey(
    'raw', bs(wrapped), unwrappingKek, 'AES-KW',
    { name: 'AES-KW', length: 256 },
    /* extractable */ true, ['wrapKey'],
  );
  const raw = await crypto.subtle.exportKey('raw', tmp);
  return new Uint8Array(raw);
}

async function importMasterKek(rawMasterKek: Uint8Array): Promise<MasterKek> {
  const wrap = await crypto.subtle.importKey(
    'raw', bs(rawMasterKek), { name: 'AES-KW', length: 256 }, /* extractable */ false, ['wrapKey', 'unwrapKey'],
  );
  const hmac = await crypto.subtle.importKey(
    'raw', bs(rawMasterKek), { name: 'HMAC', hash: 'SHA-256', length: 256 }, /* extractable */ false, ['sign'],
  );
  return { wrap, hmac };
}

function bytesToBase64(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
