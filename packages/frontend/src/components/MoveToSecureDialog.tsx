import React, { useEffect, useMemo, useState } from 'react';
import { authHeaders } from '../auth';
import { encryptAttachmentBytes, getMasterKekOrThrow, VaultLockedError } from '../crypto/secure-io';
import { encrypt } from '../crypto/envelope';
import { decodeVaultMetaWire } from '../crypto/master-kek';
import { DEFAULT_ARGON2_PARAMS } from '../crypto/argon2';
import { ENCRYPTED_FOLDER_LABEL } from '../crypto/path-predicates';
import * as api from '../api';
import { PassphrasePromptDialog } from './PassphrasePromptDialog';

interface RevocationCounts {
  grants: number;
  shareLinks: number;
  pinSet: boolean;
}

interface Props {
  src: string;
  /** New path under `_secure/`. Defaults to `_users/{me}/_secure/{filename}`. */
  defaultDest: string;
  myEmail: string;
  onDone: () => void;
  onCancel: () => void;
}

const baseHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' });

function bytesToBase64(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

/**
 * Move-into-`_secure/` is the destructive cliff: every grant is revoked,
 * share-links deleted, PIN cleared, and the file's last server-readable copy
 * is the CEK handoff. The dialog enumerates the revocations and prompts for
 * the passphrase if the master-KEK isn't already cached.
 */
export function MoveToSecureDialog({ src, defaultDest, myEmail, onDone, onCancel }: Props) {
  const destPrefix = `_users/${myEmail}/_secure/`;
  const displayPrefix = `/${myEmail}/${ENCRYPTED_FOLDER_LABEL}/`;
  const initialFilename = useMemo(() => {
    return defaultDest.startsWith(destPrefix)
      ? defaultDest.slice(destPrefix.length)
      : (defaultDest.split('/').pop() ?? '');
  }, [defaultDest, destPrefix]);
  const [filename, setFilename] = useState(initialFilename);
  const dest = `${destPrefix}${filename}`;
  const [counts, setCounts] = useState<RevocationCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listGrants('grantor').then((all) => all.filter((g) => g.path === src).length).catch(() => 0),
      // We don't have a direct "list share-links by path" API; the move
      // endpoint is idempotent so we report the worst-case "1 if any".
      Promise.resolve(0),
    ])
      .then(([grants, shareLinks]) => {
        if (cancelled) return;
        setCounts({ grants, shareLinks, pinSet: false /* unknown without dedicated endpoint */ });
      })
      .catch(() => {
        if (cancelled) return;
        setCounts({ grants: 0, shareLinks: 0, pinSet: false });
      });
    return () => { cancelled = true; };
  }, [src]);

  const handleMove = async () => {
    setBusy(true);
    setError(null);
    try {
      const masterKek = await getMasterKekOrThrow();
      // Fetch the AAD-bound passphrase salt so the envelope can carry the
      // matching kdf_params. The salt lives in the user's vault meta.
      const wire = await api.getVaultMeta();
      const meta = decodeVaultMetaWire(wire);
      if (!meta) throw new Error('vault is not set up');

      // 1. Server-side handoff: pull the plaintext + a one-shot signed token.
      const handoffRes = await fetch(`/api/files/secure/cek-handoff?path=${encodeURIComponent(src)}`, {
        headers: authHeaders(),
      });
      if (!handoffRes.ok) {
        const data = await handoffRes.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to fetch handoff');
      }
      const handoff = await handoffRes.json() as { plaintext: string; handoffToken: string };

      // 2. Encrypt under the master-KEK with AAD bound to the destination path.
      const envelope = await encrypt(
        new TextEncoder().encode(handoff.plaintext),
        dest,
        masterKek,
        DEFAULT_ARGON2_PARAMS,
        meta.passphrase_salt,
        'note',
        'personal',
      );

      // 3. POST the move with the one-shot token. Server revokes grants /
      // share-links / PIN, writes the envelope at dest, deletes src — all in
      // one atomic-ish step.
      const moveRes = await fetch('/api/files/move-to-secure', {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify({
          src,
          encryptedEnvelope: bytesToBase64(envelope),
          handoffToken: handoff.handoffToken,
        }),
      });
      if (!moveRes.ok) {
        const data = await moveRes.json().catch(() => ({}));
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
        <h3 className="modal-title">Move to {ENCRYPTED_FOLDER_LABEL}</h3>
        <p className="modal-subtitle" style={{ opacity: 0.85, marginTop: 0, fontSize: '0.85rem' }}>
          The file becomes end-to-end encrypted. Kalepin servers can no longer read it.
        </p>
        <label className="vault-setup-label">Destination</label>
        <div className="path-input-row">
          <span className="path-input-prefix" title={destPrefix}>{displayPrefix}</span>
          <input
            type="text"
            className="modal-input path-input-name"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="vault-setup-warning" style={{ marginTop: 12 }}>
          <strong>This action will:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>End-to-end encrypt the file under your master-KEK.</li>
            <li>Revoke all {counts ? `${counts.grants}` : ''} grant(s) on the source path.</li>
            <li>Delete any share-link for the source path.</li>
            <li>Clear the PIN, if any.</li>
            <li>FTS, semantic search, comments, OT, and MCP read access stop working on this file.</li>
          </ul>
        </div>
        {error && <div style={{ color: 'var(--kalepin-color-danger, #c33)', marginTop: 8, fontSize: '0.85rem' }}>{error}</div>}
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="modal-btn modal-btn-confirm" onClick={() => void handleMove()} disabled={busy || filename.length === 0 || filename.includes('/')}>
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}
