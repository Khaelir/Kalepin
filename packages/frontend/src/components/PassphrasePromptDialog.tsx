import React, { useEffect, useRef, useState } from 'react';
import { unlockWithPassphrase, decodeVaultMetaWire, type VaultMeta } from '../crypto/master-kek';
import * as api from '../api';

interface Props {
  /** Path the user is trying to read; shown as context in the dialog. */
  path?: string;
  onUnlock: () => void;
  onCancel: () => void;
  onUseRecovery?: () => void;
}

/**
 * First-`_secure/`-access prompt. Fetches `vault-meta`, derives the master-KEK
 * via Argon2id, and caches it as a non-extractable handle in IndexedDB.
 * Subsequent reads in the same browser bypass this dialog entirely.
 */
export function PassphrasePromptDialog({ path, onUnlock, onCancel, onUseRecovery }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<VaultMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getVaultMeta()
      .then((wire) => {
        if (cancelled) return;
        const decoded = decodeVaultMetaWire(wire);
        if (!decoded) {
          setMetaError('Vault is not set up yet.');
          return;
        }
        setMeta(decoded);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setMetaError(err.message || 'Could not load vault metadata.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !meta || !passphrase) return;
    setBusy(true);
    setError(null);
    try {
      await unlockWithPassphrase(passphrase, meta);
      onUnlock();
    } catch (err) {
      // WebCrypto's unwrap throws OperationError on a wrong passphrase. We
      // can't distinguish this from a corrupted blob without a fingerprint
      // round-trip, so the message stays generic.
      setError('Wrong passphrase.');
      setPassphrase('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">Unlock your Encrypted Folder</h3>
        <p className="modal-subtitle" style={{ opacity: 0.75, marginTop: 0, fontSize: '0.85rem' }}>
          {path
            ? <>This file is end-to-end encrypted. Enter your passphrase to decrypt it locally.</>
            : <>This folder is end-to-end encrypted. Enter your passphrase to decrypt its contents locally.</>}
        </p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="modal-input"
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={busy || !meta}
            aria-invalid={!!error}
          />
          {metaError && (
            <div style={{ fontSize: '0.85rem', color: 'var(--color-danger, #c33)', marginTop: 4 }}>
              {metaError}
            </div>
          )}
          {error && (
            <div style={{ fontSize: '0.85rem', color: 'var(--color-danger, #c33)', marginTop: 4 }}>
              {error}
            </div>
          )}
          {onUseRecovery && meta?.recovery_wrapped_kek && (
            <div style={{ fontSize: '0.8rem', marginTop: 8 }}>
              <button
                type="button"
                onClick={onUseRecovery}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--kalepin-primary)',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Use my 24-word recovery phrase instead
              </button>
            </div>
          )}
          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="modal-btn modal-btn-confirm"
              disabled={busy || !meta || !passphrase}
            >
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
