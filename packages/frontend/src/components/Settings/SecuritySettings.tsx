import React, { useEffect, useState } from 'react';
import * as api from '../../api';
import {
  decodeVaultMetaWire,
  regenerateRecovery,
  rotatePassphrase,
  type VaultMeta,
} from '../../crypto/master-kek';
import { generateRecoveryPhrase, recoveryPhraseToBytes, splitPhraseWords } from '../../crypto/bip39';
import { evaluateSetupGate } from '../../crypto/setup-gate';
import { STRENGTH_LABELS } from '../../crypto/passphrase-strength';
import { clearCachedMasterKek } from '../../crypto/key-store';
import { clearRecoveryUnlockPending, isRecoveryUnlockPending } from '../../crypto/recovery-pending';
import { PassphraseSetupDialog } from '../PassphraseSetupDialog';

type Mode =
  | { kind: 'idle' }
  | { kind: 'rotate'; current: string; next: string; confirm: string; typed: string }
  | { kind: 'rotating' }
  | {
      kind: 'regenerate-prompt';
      current: string;
    }
  | {
      kind: 'regenerate-reveal';
      current: string;
      phrase: string;
      challenge: number;
      answer: string;
    }
  | { kind: 'regenerate-saving' }
  | { kind: 'reset'; typedEmail: string }
  | { kind: 'resetting' }
  | { kind: 'setup' };

interface Props {
  userEmail: string;
}

function bytesToBase64(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

export function SecuritySettings({ userEmail }: Props) {
  const [meta, setMeta] = useState<VaultMeta | null>(null);
  const [vaultStatus, setVaultStatus] = useState<{ setupAt: number | null; tombstoneAt: number | null }>({ setupAt: null, tombstoneAt: null });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });

  const reloadMeta = async () => {
    try {
      const wire = await api.getVaultMeta();
      setVaultStatus({ setupAt: wire.vault_setup_at, tombstoneAt: wire.vault_tombstone_at });
      setMeta(decodeVaultMetaWire(wire));
    } catch (err) {
      setError((err as Error).message || 'Failed to load vault meta');
    }
  };

  useEffect(() => {
    void reloadMeta();
  }, []);

  // ─── Rotate passphrase ────────────────────────────────────────────────
  const renderRotate = () => {
    if (mode.kind !== 'rotate' && mode.kind !== 'rotating') return null;
    const m = mode.kind === 'rotate' ? mode : { current: '', next: '', confirm: '', typed: '' };
    const gate = evaluateSetupGate({
      passphrase: m.next,
      confirm: m.confirm,
      typedConfirmation: m.typed,
      recoveryChoice: 'skip',
    });
    return (
      <div className="security-settings-block">
        <h4>Change passphrase</h4>
        {!meta && <p className="error">Vault not set up.</p>}
        <label className="vault-setup-label">Current passphrase</label>
        <input
          type="password"
          className="modal-input"
          value={m.current}
          onChange={(e) => setMode({ ...m, kind: 'rotate', current: e.target.value })}
          disabled={mode.kind === 'rotating'}
        />
        <label className="vault-setup-label" style={{ marginTop: 8 }}>New passphrase</label>
        <input
          type="password"
          className="modal-input"
          value={m.next}
          onChange={(e) => setMode({ ...m, kind: 'rotate', next: e.target.value })}
          disabled={mode.kind === 'rotating'}
        />
        <label className="vault-setup-label" style={{ marginTop: 8 }}>Confirm new passphrase</label>
        <input
          type="password"
          className="modal-input"
          value={m.confirm}
          onChange={(e) => setMode({ ...m, kind: 'rotate', confirm: e.target.value })}
          disabled={mode.kind === 'rotating'}
        />
        {m.next && (
          <div style={{ fontSize: '0.78rem', opacity: 0.75, marginTop: 4 }}>
            Strength: {STRENGTH_LABELS[gate.score]}{gate.score < 3 && ' — must be Strong or higher'}
          </div>
        )}
        <label className="vault-setup-label" style={{ marginTop: 8 }}>
          Type <strong>I understand</strong> to acknowledge:
        </label>
        <input
          type="text"
          className="modal-input"
          value={m.typed}
          onChange={(e) => setMode({ ...m, kind: 'rotate', typed: e.target.value })}
          disabled={mode.kind === 'rotating'}
        />
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="modal-btn modal-btn-cancel" onClick={() => setMode({ kind: 'idle' })} disabled={mode.kind === 'rotating'}>Cancel</button>
          <button
            className="modal-btn modal-btn-confirm"
            disabled={mode.kind === 'rotating' || !meta || !m.current || !gate.canSubmit}
            onClick={async () => {
              if (!meta) return;
              setMode({ kind: 'rotating' });
              setError(null);
              try {
                const r = await rotatePassphrase(meta, m.current, m.next);
                await api.putVaultMeta({
                  passphrase_wrapped_kek: bytesToBase64(r.passphrase_wrapped_kek),
                  passphrase_salt: bytesToBase64(r.passphrase_salt),
                });
                clearRecoveryUnlockPending();
                setInfo('Passphrase changed. Per-file envelopes were not rewritten.');
                setMode({ kind: 'idle' });
                await reloadMeta();
              } catch (err) {
                setError((err as Error).message || 'Failed to change passphrase');
                setMode({ kind: 'rotate', ...m });
              }
            }}
          >
            {mode.kind === 'rotating' ? 'Saving…' : 'Change passphrase'}
          </button>
        </div>
      </div>
    );
  };

  // ─── Regenerate recovery ──────────────────────────────────────────────
  const renderRegenerate = () => {
    if (mode.kind !== 'regenerate-prompt' && mode.kind !== 'regenerate-reveal' && mode.kind !== 'regenerate-saving') return null;
    if (mode.kind === 'regenerate-prompt') {
      return (
        <div className="security-settings-block">
          <h4>Regenerate recovery phrase</h4>
          <p>Generates a new 24-word phrase. The old phrase will stop working immediately.</p>
          <label className="vault-setup-label">Current passphrase</label>
          <input
            type="password"
            className="modal-input"
            value={mode.current}
            onChange={(e) => setMode({ kind: 'regenerate-prompt', current: e.target.value })}
          />
          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button className="modal-btn modal-btn-cancel" onClick={() => setMode({ kind: 'idle' })}>Cancel</button>
            <button
              className="modal-btn modal-btn-confirm"
              disabled={!mode.current}
              onClick={() => {
                const phrase = generateRecoveryPhrase();
                const challenge = Math.floor(Math.random() * 24);
                setMode({ kind: 'regenerate-reveal', current: mode.current, phrase, challenge, answer: '' });
              }}
            >
              Generate phrase
            </button>
          </div>
        </div>
      );
    }
    if (mode.kind === 'regenerate-reveal' || mode.kind === 'regenerate-saving') {
      const m = mode.kind === 'regenerate-reveal'
        ? mode
        : { current: '', phrase: '', challenge: 0, answer: '' };
      const words = splitPhraseWords(m.phrase);
      const matches = m.answer.trim().toLowerCase() === words[m.challenge];
      return (
        <div className="security-settings-block">
          <h4>Your new recovery phrase</h4>
          <p>Write this down now. We won&apos;t show it again.</p>
          <ol className="recovery-words">
            {words.map((w, i) => (
              <li key={i}><span className="recovery-word-index">{i + 1}.</span><code>{w}</code></li>
            ))}
          </ol>
          <label className="vault-setup-label" style={{ marginTop: 12 }}>
            Type word <strong>{m.challenge + 1}</strong>:
          </label>
          <input
            type="text"
            className="modal-input"
            value={m.answer}
            onChange={(e) => mode.kind === 'regenerate-reveal' && setMode({ ...mode, answer: e.target.value })}
            disabled={mode.kind === 'regenerate-saving'}
          />
          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button className="modal-btn modal-btn-cancel" onClick={() => setMode({ kind: 'idle' })} disabled={mode.kind === 'regenerate-saving'}>Cancel</button>
            <button
              className="modal-btn modal-btn-confirm"
              disabled={mode.kind === 'regenerate-saving' || !matches || !meta}
              onClick={async () => {
                if (!meta || mode.kind !== 'regenerate-reveal') return;
                setMode({ kind: 'regenerate-saving' });
                setError(null);
                try {
                  const recoveryBytes = recoveryPhraseToBytes(m.phrase);
                  const r = await regenerateRecovery(meta, m.current, recoveryBytes);
                  await api.putVaultMeta({
                    passphrase_wrapped_kek: bytesToBase64(meta.passphrase_wrapped_kek),
                    passphrase_salt: bytesToBase64(meta.passphrase_salt),
                    recovery_wrapped_kek: bytesToBase64(r.recovery_wrapped_kek),
                    recovery_salt: bytesToBase64(r.recovery_salt),
                  });
                  setInfo('Recovery phrase regenerated. The old phrase no longer works.');
                  setMode({ kind: 'idle' });
                  await reloadMeta();
                } catch (err) {
                  setError((err as Error).message || 'Failed to save recovery phrase');
                  setMode({ kind: 'regenerate-reveal', ...m });
                }
              }}
            >
              {mode.kind === 'regenerate-saving' ? 'Saving…' : 'Save phrase'}
            </button>
          </div>
        </div>
      );
    }
    return null;
  };

  // ─── Reset vault ──────────────────────────────────────────────────────
  const renderReset = () => {
    if (mode.kind !== 'reset' && mode.kind !== 'resetting') return null;
    const m = mode.kind === 'reset' ? mode : { typedEmail: '' };
    const matches = m.typedEmail.trim().toLowerCase() === userEmail.toLowerCase();
    return (
      <div className="security-settings-block security-settings-danger">
        <h4>Reset Encrypted Folder</h4>
        <div className="vault-setup-warning">
          <strong>⚠⚠⚠ DESTRUCTIVE — UNRECOVERABLE.</strong>
          <div style={{ marginTop: 4 }}>
            This permanently deletes every file in your Encrypted Folder. They are
            end-to-end encrypted; no Kalepin operator, admin, or staff member can recover the
            content. After the 24-hour grace window expires, the data is gone forever. An undo
            link will be emailed to <code>{userEmail}</code>.
          </div>
        </div>
        <label className="vault-setup-label" style={{ marginTop: 8 }}>
          Type your email (<code>{userEmail}</code>) to confirm:
        </label>
        <input
          type="email"
          className="modal-input"
          value={m.typedEmail}
          onChange={(e) => setMode({ kind: 'reset', typedEmail: e.target.value })}
          disabled={mode.kind === 'resetting'}
        />
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="modal-btn modal-btn-cancel" onClick={() => setMode({ kind: 'idle' })} disabled={mode.kind === 'resetting'}>Cancel</button>
          <button
            className="modal-btn modal-btn-danger"
            disabled={mode.kind === 'resetting' || !matches}
            onClick={async () => {
              setMode({ kind: 'resetting' });
              setError(null);
              try {
                const result = await api.resetSecureVault(m.typedEmail);
                await clearCachedMasterKek();
                setInfo(
                  `Vault reset. ${result.files_count} file(s) tombstoned. Undo via the email we sent — expires ${new Date(result.expires_at).toLocaleString()}.`,
                );
                setMode({ kind: 'idle' });
                await reloadMeta();
              } catch (err) {
                setError((err as Error).message || 'Vault reset failed');
                setMode({ kind: 'reset', typedEmail: m.typedEmail });
              }
            }}
          >
            {mode.kind === 'resetting' ? 'Resetting…' : 'Destroy my vault'}
          </button>
        </div>
      </div>
    );
  };

  if (mode.kind === 'setup') {
    return (
      <PassphraseSetupDialog
        onCancel={() => setMode({ kind: 'idle' })}
        onComplete={async () => {
          setMode({ kind: 'idle' });
          setInfo('Vault created.');
          await reloadMeta();
        }}
      />
    );
  }

  const recoveryPending = isRecoveryUnlockPending();

  return (
    <div className="security-settings">
      <h3>Security</h3>
      {recoveryPending && (
        <div className="error" role="alert">
          <strong>Your vault is unlocked via recovery phrase only.</strong> Please change
          your passphrase below before doing anything else — the recovery phrase is meant
          as a one-time fallback, not your day-to-day unlock.
        </div>
      )}
      {info && <div className="info">{info}</div>}
      {error && <div className="error">{error}</div>}
      <p>
        <strong>Vault status:</strong>{' '}
        {vaultStatus.tombstoneAt
          ? `Tombstoned ${new Date(vaultStatus.tombstoneAt).toLocaleString()}`
          : vaultStatus.setupAt
          ? `Set up ${new Date(vaultStatus.setupAt).toLocaleString()}`
          : 'Not set up'}
      </p>
      {mode.kind === 'idle' && (
        <div className="security-actions">
          {!meta && !vaultStatus.tombstoneAt && (
            <button className="modal-btn modal-btn-confirm" onClick={() => setMode({ kind: 'setup' })}>
              Set up Encrypted Folder
            </button>
          )}
          {meta && (
            <>
              <button className="modal-btn modal-btn-confirm" onClick={() => setMode({ kind: 'rotate', current: '', next: '', confirm: '', typed: '' })}>
                Change passphrase
              </button>
              <button className="modal-btn modal-btn-confirm" onClick={() => setMode({ kind: 'regenerate-prompt', current: '' })}>
                {meta.recovery_wrapped_kek ? 'Regenerate' : 'Generate'} recovery phrase
              </button>
              <button className="modal-btn modal-btn-danger" onClick={() => setMode({ kind: 'reset', typedEmail: '' })}>
                Reset vault
              </button>
            </>
          )}
        </div>
      )}
      {renderRotate()}
      {renderRegenerate()}
      {renderReset()}
    </div>
  );
}
