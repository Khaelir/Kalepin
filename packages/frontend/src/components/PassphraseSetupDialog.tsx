import React, { useEffect, useRef, useState } from 'react';
import { decodeVaultMetaWire, regenerateRecovery, setupVault, type VaultMeta } from '../crypto/master-kek';
import {
  evaluateSetupGate,
  type RecoveryChoice,
} from '../crypto/setup-gate';
import { STRENGTH_LABELS } from '../crypto/passphrase-strength';
import {
  generateRecoveryPhrase,
  recoveryPhraseToBytes,
  splitPhraseWords,
} from '../crypto/bip39';
import * as api from '../api';

interface Props {
  /**
   * Called after the master-KEK is generated, wrapped, persisted to the
   * server, cached in IndexedDB, and (if `recoveryGenerated` is true) the
   * recovery phrase has been confirmed and `recovery_wrapped_kek` saved.
   */
  onComplete: (recoveryGenerated: boolean) => void;
  onCancel: () => void;
}

type Step =
  | { kind: 'setup' }
  | {
      kind: 'reveal-recovery';
      phrase: string;
      passphrase: string;
      passphraseSalt: Uint8Array;
    }
  | { kind: 'done-skip' }
  | { kind: 'saving-recovery' };

/**
 * First-time vault setup. Hard-blocks submission until the four gates from
 * design.md pass: passphrase confirm, zxcvbn-style score ≥ 3, typed-string
 * acknowledgement of the lost-data warning, and explicit recovery option.
 *
 * The gate logic lives in `crypto/setup-gate.ts` so it can be unit-tested
 * without rendering the component.
 */
export function PassphraseSetupDialog({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'setup' });
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [typed, setTyped] = useState('');
  const [recovery, setRecovery] = useState<RecoveryChoice>('unset');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passphraseRef.current?.focus();
  }, []);

  const gate = evaluateSetupGate({ passphrase, confirm, typedConfirmation: typed, recoveryChoice: recovery });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !gate.canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { meta } = await setupVault(passphrase);
      await api.putVaultMeta({
        passphrase_wrapped_kek: bytesToBase64(meta.passphrase_wrapped_kek),
        passphrase_salt: bytesToBase64(meta.passphrase_salt),
      });
      if (recovery === 'generate') {
        const phrase = generateRecoveryPhrase();
        setStep({ kind: 'reveal-recovery', phrase, passphrase, passphraseSalt: meta.passphrase_salt });
      } else {
        onComplete(false);
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to create vault');
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'reveal-recovery' || step.kind === 'saving-recovery') {
    const phrase = step.kind === 'reveal-recovery' ? step.phrase : '';
    return (
      <RecoveryReveal
        phrase={phrase}
        busy={step.kind === 'saving-recovery'}
        onCancel={() => onComplete(false)}
        onConfirmed={async () => {
          if (step.kind !== 'reveal-recovery') return;
          setStep({ kind: 'saving-recovery' });
          try {
            const meta = await fetchMeta();
            const recoveryBytes = recoveryPhraseToBytes(phrase);
            const r = await regenerateRecovery(meta, step.passphrase, recoveryBytes);
            await api.putVaultMeta({
              passphrase_wrapped_kek: bytesToBase64(meta.passphrase_wrapped_kek),
              passphrase_salt: bytesToBase64(meta.passphrase_salt),
              recovery_wrapped_kek: bytesToBase64(r.recovery_wrapped_kek),
              recovery_salt: bytesToBase64(r.recovery_salt),
            });
            onComplete(true);
          } catch (err) {
            setError((err as Error).message || 'Failed to save recovery phrase');
            setStep({ kind: 'reveal-recovery', phrase, passphrase: step.passphrase, passphraseSalt: step.passphraseSalt });
          }
        }}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: 520 }}
      >
        <h3 className="modal-title">Set up your Encrypted Folder</h3>
        <p className="modal-subtitle" style={{ opacity: 0.75, marginTop: 0, fontSize: '0.85rem' }}>
          Choose a passphrase. It encrypts every file in your Encrypted Folder end-to-end. Kalepin servers never see it.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="vault-pass" className="vault-setup-label">Passphrase</label>
          <input
            id="vault-pass"
            ref={passphraseRef}
            className="modal-input"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={busy}
          />
          <label htmlFor="vault-pass-confirm" className="vault-setup-label" style={{ marginTop: 8 }}>Confirm passphrase</label>
          <input
            id="vault-pass-confirm"
            className="modal-input"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
          <StrengthMeter score={gate.score} hasInput={passphrase.length > 0} />

          <div className="vault-setup-warning">
            <strong>Lost passphrase = permanently lost data.</strong> No Kalepin operator,
            admin, or staff member can recover the contents of your Encrypted Folder if you
            forget this passphrase. There is no &quot;forgot passphrase&quot; link.
          </div>

          <label htmlFor="vault-typed" className="vault-setup-label" style={{ marginTop: 8 }}>
            Type <strong>I understand</strong> to acknowledge:
          </label>
          <input
            id="vault-typed"
            className="modal-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
          />

          <fieldset className="vault-setup-recovery" disabled={busy}>
            <legend className="vault-setup-label">Recovery phrase</legend>
            <label className="vault-setup-radio">
              <input
                type="radio"
                name="recovery"
                value="generate"
                checked={recovery === 'generate'}
                onChange={() => setRecovery('generate')}
              />
              <span>Generate a 24-word recovery phrase (recommended)</span>
            </label>
            <label className="vault-setup-radio">
              <input
                type="radio"
                name="recovery"
                value="skip"
                checked={recovery === 'skip'}
                onChange={() => setRecovery('skip')}
              />
              <span>Skip — I&apos;ll remember the passphrase</span>
            </label>
          </fieldset>

          {error && (
            <div style={{ fontSize: '0.85rem', color: 'var(--color-danger, #c33)', marginTop: 8 }}>
              {error}
            </div>
          )}

          {!gate.canSubmit && gate.reasons.length > 0 && (
            <ul className="vault-setup-reasons">
              {gate.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}

          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="modal-btn modal-btn-confirm"
              disabled={busy || !gate.canSubmit}
            >
              {busy ? 'Creating…' : 'Create vault'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StrengthMeter({ score, hasInput }: { score: number; hasInput: boolean }) {
  if (!hasInput) return null;
  const segments = [0, 1, 2, 3, 4].map((i) => i <= score);
  const colors = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9'];
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {segments.map((on, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: on ? colors[score] : 'var(--kalepin-border, #ccc)',
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: '0.75rem', opacity: 0.75, marginTop: 4 }}>
        Strength: {STRENGTH_LABELS[score]}{score < 3 && ' — needs to be at least Strong'}
      </div>
    </div>
  );
}

function bytesToBase64(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

async function fetchMeta(): Promise<VaultMeta> {
  const wire = await api.getVaultMeta();
  const decoded = decodeVaultMetaWire(wire);
  if (!decoded) throw new Error('vault meta unexpectedly missing');
  return decoded;
}

interface RecoveryRevealProps {
  phrase: string;
  busy: boolean;
  onCancel: () => void;
  onConfirmed: () => Promise<void>;
}

/**
 * One-time recovery-phrase reveal. The "type word N" challenge enforces
 * that the user has actually copied the phrase out of the dialog before
 * we save the wrapped KEK and dismiss. Skipping the challenge would let a
 * muscle-memory click leave the user without recovery.
 */
function RecoveryReveal({ phrase, busy, onCancel, onConfirmed }: RecoveryRevealProps) {
  const words = splitPhraseWords(phrase);
  // Pick a stable challenge index across renders.
  const challengeRef = useRef<number>(Math.floor(Math.random() * words.length));
  const challengeIdx = challengeRef.current;
  const [answer, setAnswer] = useState('');
  const matches = answer.trim().toLowerCase() === words[challengeIdx];

  return (
    <div className="modal-overlay">
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 540 }}>
        <h3 className="modal-title">Your recovery phrase</h3>
        <p className="modal-subtitle" style={{ opacity: 0.85, marginTop: 0, fontSize: '0.85rem' }}>
          Write this down <strong>now</strong>. We will not show it again. Anyone with
          this phrase can decrypt every file in your Encrypted Folder — treat
          it like the passphrase.
        </p>
        <ol className="recovery-words">
          {words.map((w, i) => (
            <li key={i}><span className="recovery-word-index">{i + 1}.</span><code>{w}</code></li>
          ))}
        </ol>
        <label htmlFor="recovery-challenge" className="vault-setup-label" style={{ marginTop: 12 }}>
          Type word <strong>{challengeIdx + 1}</strong> to confirm:
        </label>
        <input
          id="recovery-challenge"
          className="modal-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={busy}
        />
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>
            Skip recovery
          </button>
          <button
            type="button"
            className="modal-btn modal-btn-confirm"
            disabled={busy || !matches}
            onClick={() => { void onConfirmed(); }}
          >
            {busy ? 'Saving…' : "I've saved it — continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
