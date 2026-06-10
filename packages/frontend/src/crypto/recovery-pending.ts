// Tracks whether the master-KEK is currently unwrapped via the recovery
// phrase rather than the passphrase. While this flag is set the user MUST
// rotate to a new passphrase before they can navigate away from
// Settings → Security; otherwise the recovery phrase becomes the de-facto
// primary unlock and the original passphrase remains a stale attack surface.
//
// We persist to localStorage so a tab reload doesn't lose the rotation
// pressure — the flag is purely a UX gate, not a security property, so the
// looser persistence is fine.

const KEY = 'e2e-recovery-unlock-pending';

export function setRecoveryUnlockPending(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* private browsing — ignore */ }
}

export function clearRecoveryUnlockPending(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function isRecoveryUnlockPending(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
