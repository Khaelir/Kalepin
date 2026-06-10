import React, { useMemo, useState } from 'react';
import { authHeaders } from '../auth';
import { readSecureNote, VaultLockedError } from '../crypto/secure-io';
import { ENCRYPTED_FOLDER_LABEL } from '../crypto/path-predicates';
import { PassphrasePromptDialog } from './PassphrasePromptDialog';

interface Props {
  src: string;
  /** Default plaintext destination, e.g., `_users/{me}/Notes/{filename}`. */
  defaultDest: string;
  myEmail: string;
  onDone: () => void;
  onCancel: () => void;
}

const baseHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' });

/**
 * Move out of `_secure/`. The client decrypts the envelope locally (using the
 * cached master-KEK or a fresh passphrase entry) and uploads plaintext to a
 * non-`_secure/` destination. The encrypting storage adapter re-envelopes
 * under the server KEK at the destination.
 */
export function MoveFromSecureDialog({ src, defaultDest, myEmail, onDone, onCancel }: Props) {
  const personalPrefix = `_users/${myEmail}/`;
  const displayPrefix = `/${myEmail}/`;
  const initialSubpath = useMemo(() => {
    return defaultDest.startsWith(personalPrefix)
      ? defaultDest.slice(personalPrefix.length)
      : (defaultDest.split('/').pop() ?? '');
  }, [defaultDest, personalPrefix]);
  const [subpath, setSubpath] = useState(initialSubpath);
  const dest = `${personalPrefix}${subpath}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  const handleMove = async () => {
    setBusy(true);
    setError(null);
    try {
      const plaintext = await readSecureNote(src);
      const res = await fetch('/api/files/move-from-secure', {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify({ src, dest, content: plaintext }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Move failed');
      }
      onDone();
    } catch (err) {
      if (err instanceof VaultLockedError) {
        setNeedsUnlock(true);
        return;
      }
      setError((err as Error).message || 'Move failed');
    } finally {
      setBusy(false);
    }
  };

  if (needsUnlock) {
    return (
      <PassphrasePromptDialog
        path={src}
        onUnlock={() => { setNeedsUnlock(false); void handleMove(); }}
        onCancel={() => { setNeedsUnlock(false); onCancel(); }}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
        <h3 className="modal-title">Move out of {ENCRYPTED_FOLDER_LABEL}</h3>
        <p className="modal-subtitle" style={{ opacity: 0.85, marginTop: 0, fontSize: '0.85rem' }}>
          The file becomes server-readable again. Search, comments, share-links, and OT collaboration work after the move.
        </p>
        <label className="vault-setup-label">Destination</label>
        <div className="path-input-row">
          <span className="path-input-prefix" title={personalPrefix}>{displayPrefix}</span>
          <input
            type="text"
            className="modal-input path-input-name"
            value={subpath}
            onChange={(e) => setSubpath(e.target.value)}
            disabled={busy}
          />
        </div>
        {error && <div style={{ color: 'var(--kalepin-color-danger, #c33)', marginTop: 8, fontSize: '0.85rem' }}>{error}</div>}
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="modal-btn modal-btn-confirm"
            onClick={() => void handleMove()}
            disabled={busy || subpath.length === 0 || subpath.startsWith('_secure/') || subpath === '_secure'}
          >
            {busy ? 'Moving…' : 'Move out'}
          </button>
        </div>
      </div>
    </div>
  );
}
