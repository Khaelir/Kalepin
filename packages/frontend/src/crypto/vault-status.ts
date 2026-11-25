// When to offer first-time Encrypted Folder setup. Setup generates a new
// master-KEK, so running it over an existing vault would leave every file in
// it undecryptable. It is only offered when the server said there is no
// vault — a status that failed to load looks the same as "not set up" and
// must not be read as one.

export type VaultLoadState = 'loading' | 'loaded' | 'failed';

/** Settings → Security: show "Set up Encrypted Folder"? */
export function canOfferVaultSetup(load: VaultLoadState, hasVault: boolean, tombstoned: boolean): boolean {
  return load === 'loaded' && !hasVault && !tombstoned;
}

interface VaultSetupStatus {
  vault_setup_at: number | null;
}

/**
 * Sidebar click on the Encrypted Folder. `fresh` is the status just fetched
 * (null when the fetch failed), `cached` the one loaded earlier, if any.
 * 'unlock' means the vault exists: check for a cached key, else prompt.
 */
export function secureFolderAction(
  fresh: VaultSetupStatus | null,
  cached: VaultSetupStatus | null,
): 'setup' | 'unlock' | 'unavailable' {
  if (fresh) return fresh.vault_setup_at ? 'unlock' : 'setup';
  // Server unreachable: a vault already known to exist can still be
  // unlocked, but setup is never offered on a guess.
  return cached?.vault_setup_at ? 'unlock' : 'unavailable';
}
