import React, { useEffect, useRef, useState } from 'react';
import {
  decodeVaultMetaWire,
  unlockWithRecovery,
  type VaultMeta,
} from '../crypto/master-kek';
import {
  isWordInWordlist,
  recoveryPhraseToBytes,
  splitPhraseWords,
} from '../crypto/bip39';
import { setRecoveryUnlockPending } from '../crypto/recovery-pending';
import * as api from '../api';

interface Props {
  /**
   * Called after the master-KEK is unwrapped from `recovery_wrapped_kek` and
   * cached. The caller is responsible for surfacing the
   * `recoveryUnlockPending` banner and routing the user to passphrase
   * rotation before they can interact with `_secure/` again.
   */
  onUnlock: () => void;
  onCancel: () => void;
}

/**
 * Backstop unlock when the user has lost the passphrase but still has the
 * 24-word recovery phrase. Validates each word against the BIP-39 wordlist
 * before attempting the Argon2id derivation, so a typo never burns the slow
 * KDF round.
 */
export function RecoveryUnlockDialog({ onUnlock, onCancel }: Props) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<VaultMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getVaultMeta()
      .then((wire) => {
        if (cancelled) return;
        const decoded = decodeVaultMetaWire(wire);
        if (!decoded || !decoded.recovery_wrapped_kek) {
          setMetaError('No recovery phrase is configured for this account.');
          return;
        }
        setMeta(decoded);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setMetaError(err.message || 'Could not load vault metadata.');
      });
    return () => { cancelled = true; };
  }, []);

  const words = splitPhraseWords(phrase);
  const allWordsValid = words.length === 24 && words.every((w) => isWordInWordlist(w));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !meta) return;
    if (words.length !== 24) {
      setError('Recovery phrase must be exactly 24 words.');
      return;
    }
    const invalid = words.filter((w) => !isWordInWordlist(w));
    if (invalid.length > 0) {
      setError(`Unknown word(s): ${invalid.slice(0, 3).join(', ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const recoveryBytes = recoveryPhraseToBytes(phrase);
      await unlockWithRecovery(recoveryBytes, meta);
      setRecoveryUnlockPending();
      // Caller now hosts the rotation-required state — see SecuritySettings
      // for the banner and the rotate flow that clears the flag.
      onUnlock();
    } catch (err) {
      setError('Recovery phrase did not match. Double-check the words.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 520 }}>
        <h3 className="modal-title">Unlock with recovery phrase</h3>
        <p className="modal-subtitle" style={{ opacity: 0.85, marginTop: 0, fontSize: '0.85rem' }}>
          Paste your 24-word recovery phrase. We&apos;ll derive your vault key
          locally and ask you to set a new passphrase right after.
        </p>
        <form onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            className="modal-input"
            style={{ minHeight: 96, fontFamily: 'inherit', resize: 'vertical' }}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            disabled={busy || !meta}
            placeholder="abandon ability able about above absent absorb abstract..."
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!error}
          />
          <div style={{ fontSize: '0.78rem', opacity: 0.75, marginTop: 4 }}>
            Words entered: {words.length}/24
            {words.length > 0 && !allWordsValid && (
              <span style={{ color: 'var(--kalepin-color-danger, #c33)', marginLeft: 8 }}>
                Some words aren&apos;t in the BIP-39 wordlist.
              </span>
            )}
          </div>
          {metaError && (
            <div style={{ fontSize: '0.85rem', color: 'var(--color-danger, #c33)', marginTop: 8 }}>{metaError}</div>
          )}
          {error && (
            <div style={{ fontSize: '0.85rem', color: 'var(--color-danger, #c33)', marginTop: 8 }}>{error}</div>
          )}
          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="modal-btn modal-btn-confirm"
              disabled={busy || !meta || !allWordsValid}
            >
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
