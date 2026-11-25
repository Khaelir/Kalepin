import { describe, it, expect } from 'vitest';
import { canOfferVaultSetup, secureFolderAction } from './vault-status';

describe('canOfferVaultSetup', () => {
  it('offers setup when the server says there is no vault', () => {
    expect(canOfferVaultSetup('loaded', false, false)).toBe(true);
  });

  it('does not offer setup when the vault status failed to load', () => {
    expect(canOfferVaultSetup('failed', false, false)).toBe(false);
  });

  it('does not offer setup while the status is loading', () => {
    expect(canOfferVaultSetup('loading', false, false)).toBe(false);
  });

  it('does not offer setup over an existing or tombstoned vault', () => {
    expect(canOfferVaultSetup('loaded', true, false)).toBe(false);
    expect(canOfferVaultSetup('loaded', false, true)).toBe(false);
  });
});

describe('secureFolderAction', () => {
  it('routes to setup only when the server says there is no vault', () => {
    expect(secureFolderAction({ vault_setup_at: null }, null)).toBe('setup');
  });

  it('routes to unlock when the vault exists', () => {
    expect(secureFolderAction({ vault_setup_at: 1 }, null)).toBe('unlock');
    expect(secureFolderAction({ vault_setup_at: 1 }, { vault_setup_at: null })).toBe('unlock');
  });

  it('never routes to setup when the status fetch failed', () => {
    expect(secureFolderAction(null, null)).toBe('unavailable');
    expect(secureFolderAction(null, { vault_setup_at: null })).toBe('unavailable');
  });

  it('still unlocks a vault known from an earlier load when the fetch failed', () => {
    expect(secureFolderAction(null, { vault_setup_at: 1 })).toBe('unlock');
  });
});
