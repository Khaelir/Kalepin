import React, { useEffect, useRef, useState } from 'react';
import * as api from '../api';

type Mode = 'set' | 'verify';

interface CommonProps {
  path: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface SetProps extends CommonProps {
  mode: 'set';
  changing?: boolean;
}

interface VerifyProps extends CommonProps {
  mode: 'verify';
}

const PIN_RE = /^\S{8,}$/;
const PIN_MIN_LENGTH = 8;

function pinStrengthHint(pin: string): string | null {
  if (pin.length === 0) return null;
  if (pin.length >= PIN_MIN_LENGTH && /^\d+$/.test(pin)) {
    return 'Digits-only PINs are weak; mix in letters or symbols for more friction.';
  }
  return null;
}

function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PinDialog(props: SetProps | VerifyProps) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Tick once a second while we're showing a lockout countdown.
  useEffect(() => {
    if (!lockoutUntil) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [lockoutUntil]);

  const lockedNow = !!lockoutUntil && lockoutUntil > Date.now();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || lockedNow) return;
    if (!PIN_RE.test(pin)) {
      setError(`PIN must be at least ${PIN_MIN_LENGTH} characters with no whitespace.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (props.mode === 'set') {
        await api.setNotePin(props.path, pin);
      } else {
        await api.verifyNotePin(props.path, pin);
      }
      props.onSuccess();
    } catch (err) {
      if (err instanceof api.PinLockoutError) {
        setLockoutUntil(err.lockoutUntil ?? Date.now() + 15 * 60 * 1000);
        setRemainingAttempts(0);
      } else if (err instanceof api.PinWrongError) {
        setRemainingAttempts(err.remainingAttempts);
        setError(`Wrong PIN. ${err.remainingAttempts} attempt${err.remainingAttempts === 1 ? '' : 's'} left.`);
      } else {
        setError((err as Error).message || 'Something went wrong');
      }
      setPin('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  const setMode = props.mode === 'set';
  const title = setMode
    ? (props.changing ? 'Change PIN' : 'Set PIN')
    : 'Enter PIN';
  const submitLabel = setMode ? 'Save PIN' : 'Unlock';

  return (
    <div className="modal-overlay modal-overlay-top" onClick={props.onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">{title}</h3>
        <p className="modal-subtitle" style={{ opacity: 0.75, marginTop: 0, fontSize: '0.85rem' }}>
          {setMode
            ? `A lightweight gate to add friction (min ${PIN_MIN_LENGTH} characters). Not end-to-end encryption.`
            : 'This note is locked. Enter the PIN to read or edit it.'}
        </p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="modal-input"
            type="password"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={`At least ${PIN_MIN_LENGTH} characters, no spaces`}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\s+/g, ''))}
            disabled={busy || lockedNow}
            aria-invalid={!!error}
          />

          {setMode && pinStrengthHint(pin) && (
            <div className="pin-strength-hint" style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: 4 }}>
              {pinStrengthHint(pin)}
            </div>
          )}

          {!setMode && remainingAttempts !== null && !lockedNow && (
            <div className="pin-attempts" style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: 4 }}>
              Attempts left: {remainingAttempts}
            </div>
          )}

          {lockedNow && lockoutUntil && (
            <div className="pin-lockout" style={{ fontSize: '0.85rem', color: 'var(--color-danger, #c33)', marginTop: 4 }}>
              Locked. Try again in {formatRemaining(lockoutUntil - Date.now())}.
            </div>
          )}

          {error && !lockedNow && (
            <div className="pin-error" style={{ fontSize: '0.85rem', color: 'var(--color-danger, #c33)', marginTop: 4 }}>
              {error}
            </div>
          )}

          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button type="button" className="modal-btn modal-btn-cancel" onClick={props.onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="modal-btn modal-btn-confirm"
              disabled={busy || lockedNow || !PIN_RE.test(pin)}
            >
              {busy ? '...' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
