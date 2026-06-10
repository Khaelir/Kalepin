// Routine read/save of `_secure/` files. Wraps the backend's
// `/api/files/secure/read|write|create` endpoints: the network carries
// envelope bytes only, and the master-KEK never leaves the browser.

import { authHeaders } from '../auth';
import { decrypt, encrypt } from './envelope';
import { loadCachedMasterKek, type MasterKek } from './key-store';
import { decodeVaultMetaWire, type VaultMeta } from './master-kek';
import { DEFAULT_ARGON2_PARAMS } from './argon2';
import { markSelfSaved } from '../self-saved-paths';

const baseHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' });

export class VaultLockedError extends Error {
  constructor() {
    super('vault is locked');
    this.name = 'VaultLockedError';
  }
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

export async function getMasterKekOrThrow(): Promise<MasterKek> {
  const cached = await loadCachedMasterKek();
  if (!cached) throw new VaultLockedError();
  return cached;
}

/**
 * Fetch the vault's `passphrase_salt` so the AAD-bound envelope can carry
 * matching kdf_params. The salt itself is opaque to the server and is the
 * only path-independent state needed for an envelope encrypt.
 */
async function getPassphraseSalt(): Promise<Uint8Array> {
  const res = await fetch('/api/users/me/vault-meta', { headers: authHeaders() });
  if (!res.ok) throw new Error('failed to fetch vault meta');
  const wire = await res.json();
  const meta = decodeVaultMetaWire(wire) as VaultMeta | null;
  if (!meta) throw new Error('vault is not set up');
  return meta.passphrase_salt;
}

/**
 * Read an `_secure/` note as plaintext UTF-8. Throws `VaultLockedError` if
 * the master-KEK is not currently cached in IndexedDB.
 */
export async function readSecureNote(path: string): Promise<string> {
  const masterKek = await getMasterKekOrThrow();
  const res = await fetch(`/api/files/secure/read?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`failed to read ${path}`);
  const data = (await res.json()) as { path: string; envelope: string };
  const envelopeBytes = base64ToBytes(data.envelope);
  const plaintextBytes = await decrypt(envelopeBytes, path, masterKek);
  return new TextDecoder().decode(plaintextBytes);
}

/**
 * Encrypt and upload note content. The path is bound into the envelope's AAD
 * so re-using the ciphertext at a different path will fail the auth tag.
 */
export async function writeSecureNote(path: string, content: string, opts: { create?: boolean } = {}): Promise<void> {
  const masterKek = await getMasterKekOrThrow();
  const salt = await getPassphraseSalt();
  const plaintext = new TextEncoder().encode(content);
  const envelope = await encrypt(plaintext, path, masterKek, DEFAULT_ARGON2_PARAMS, salt, 'note', 'personal');
  const endpoint = opts.create ? '/api/files/secure/create' : '/api/files/secure/write';
  // Mark before issuing the request: the chokidar watcher can fire faster than
  // the fetch promise resolves (especially with create -> write debounce).
  markSelfSaved(path);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ path, envelope: bytesToBase64(envelope) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `failed to write ${path}`);
  }
}

/**
 * Encrypt arbitrary bytes (e.g., an image) at a `_secure/_attachments/...`
 * path. Returns the envelope bytes the caller can POST to
 * `/api/files/secure/create`. Used by the image-paste handler so attachments
 * don't traverse the server in the clear.
 */
export async function encryptAttachmentBytes(path: string, bytes: Uint8Array, kind: 'attachment' = 'attachment'): Promise<Uint8Array> {
  const masterKek = await getMasterKekOrThrow();
  const salt = await getPassphraseSalt();
  return encrypt(bytes, path, masterKek, DEFAULT_ARGON2_PARAMS, salt, kind, 'personal');
}

export async function decryptAttachmentBytes(path: string, envelope: Uint8Array): Promise<Uint8Array> {
  const masterKek = await getMasterKekOrThrow();
  return decrypt(envelope, path, masterKek);
}
