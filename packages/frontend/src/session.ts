import { clearLocalUserState, clearToken } from './auth';
import { clearCachedMasterKek } from './crypto/key-store';

/**
 * End the session in this browser: drop the token and everything kept for
 * the signed-in user — recent notes, the recovery-unlock flag and the
 * unlocked Encrypted Folder key — so whoever signs in next (the same user
 * included) has to unlock the folder with the passphrase again. Await it
 * before reloading the page: the IndexedDB delete is asynchronous.
 */
export async function clearSession(): Promise<void> {
  clearToken();
  clearLocalUserState();
  try {
    await clearCachedMasterKek();
  } catch {
    /* IndexedDB unavailable — a leftover key is still only handed to its owner (key-store) */
  }
}
