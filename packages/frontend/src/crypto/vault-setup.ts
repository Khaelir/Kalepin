import { DEFAULT_ARGON2_PARAMS, type Argon2Params } from './argon2';
import { cacheMasterKek, clearCachedMasterKek, loadCachedMasterKek } from './key-store';
import { setupVault, type VaultMeta } from './master-kek';

/**
 * First-time vault setup: generate the master-KEK (which `setupVault` caches
 * in this browser) and hand its wrapping to `save` — the PUT to the server.
 * If the server refuses it (a vault already exists, or the request failed),
 * this browser's cached key is put back to what it was, so the existing
 * vault's files stay readable instead of being met with a key nothing on
 * the server wraps.
 */
export async function createVault(
  passphrase: string,
  save: (meta: VaultMeta) => Promise<void>,
  argon2Params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<VaultMeta> {
  const previous = await loadCachedMasterKek();
  const { meta } = await setupVault(passphrase, argon2Params);
  try {
    await save(meta);
  } catch (err) {
    try {
      if (previous) await cacheMasterKek(previous);
      else await clearCachedMasterKek();
    } catch {
      /* best effort — the save error is what the user needs to see */
    }
    throw err;
  }
  return meta;
}
