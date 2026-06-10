import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../../api';
import type {
  EncryptionStateResponse,
  EncryptionZoneState,
  EncryptionZoneName,
} from '../../api';

const ZONE_LABEL: Record<EncryptionZoneName, string> = {
  personal: 'Personal vault',
  shared: 'Shared vault',
};

const ZONE_DESC: Record<EncryptionZoneName, string> = {
  personal:
    'Each user’s personal folder under _users/{email}/. Encrypted by default.',
  shared:
    'The shared vault under VAULT_PATH. Plaintext by default for Obsidian-on-disk compatibility.',
};

function shortFingerprint(hex: string | null): string {
  if (!hex) return '—';
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

function busyForZone(z: EncryptionZoneState): boolean {
  return z.migration_state === 'encrypting' || z.migration_state === 'decrypting';
}

function progressPct(z: EncryptionZoneState): number {
  if (!z.migration_total) return 0;
  return Math.min(100, Math.round((z.migration_progress / z.migration_total) * 100));
}

interface ZoneCardProps {
  zone: EncryptionZoneState;
  onAction: (zone: EncryptionZoneName, target: 'encrypt' | 'decrypt') => void;
  busy: boolean;
}

function ZoneCard({ zone, onAction, busy }: ZoneCardProps) {
  const sweeping = busyForZone(zone);
  const target: 'encrypt' | 'decrypt' = zone.enabled ? 'decrypt' : 'encrypt';
  const actionLabel = target === 'encrypt' ? 'Encrypt' : 'Decrypt';
  const stateLabel = sweeping
    ? zone.migration_state === 'encrypting'
      ? 'Encrypting…'
      : 'Decrypting…'
    : zone.enabled
    ? 'ON'
    : 'OFF';

  return (
    <div className="encryption-zone-card">
      <div className="encryption-zone-header">
        <div>
          <div className="encryption-zone-name">{ZONE_LABEL[zone.zone]}</div>
          <div className="encryption-zone-desc">{ZONE_DESC[zone.zone]}</div>
        </div>
        <span
          className={`encryption-zone-badge encryption-zone-badge-${
            zone.enabled ? 'on' : 'off'
          }`}
        >
          {stateLabel}
        </span>
      </div>

      <div className="encryption-zone-meta">
        <span>
          KEK fingerprint: <code>{shortFingerprint(zone.kek_fingerprint)}</code>
        </span>
        {sweeping && (
          <span>
            {zone.migration_progress}/{zone.migration_total} files
          </span>
        )}
      </div>

      {sweeping && (
        <div className="encryption-zone-progress">
          <div
            className="encryption-zone-progress-bar"
            style={{ width: `${progressPct(zone)}%` }}
          />
        </div>
      )}

      <div className="encryption-zone-actions">
        <button
          className="encryption-zone-action-btn"
          disabled={busy || sweeping}
          onClick={() => onAction(zone.zone, target)}
        >
          {sweeping ? 'Sweep in progress…' : actionLabel}
        </button>
      </div>
    </div>
  );
}

export function EncryptionSettings() {
  const [state, setState] = useState<EncryptionStateResponse | null>(null);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<{
    zone: EncryptionZoneName;
    target: 'encrypt' | 'decrypt';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getEncryptionState();
      setState(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load encryption state');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every 2s while any zone is mid-sweep; stop on idle.
  useEffect(() => {
    if (!state) return;
    const anySweeping = state.zones.some(busyForZone);
    if (!anySweeping) {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    pollTimer.current = setTimeout(() => {
      load();
    }, 2000);
    return () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [state, load]);

  const requestAction = (zone: EncryptionZoneName, target: 'encrypt' | 'decrypt') => {
    setPendingAction({ zone, target });
  };

  const cancelAction = () => setPendingAction(null);

  const confirmAction = async () => {
    if (!pendingAction) return;
    setBusy(true);
    setError('');
    try {
      if (pendingAction.target === 'encrypt') {
        await api.encryptZone(pendingAction.zone);
      } else {
        await api.decryptZone(pendingAction.zone);
      }
      setPendingAction(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start sweep');
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <section className="settings-section">
        <h2 className="settings-section-title">Encryption</h2>
        <p className="settings-section-desc">Loading…</p>
        {error && <div className="settings-error">{error}</div>}
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Encryption</h2>
      <p className="settings-section-desc">
        Per-zone at-rest encryption. Files in encrypted zones are stored as
        envelopes on disk (AES-256-GCM, KEK-wrapped CEK). API responses are
        always plaintext.
      </p>

      {error && <div className="settings-error">{error}</div>}

      <div className="encryption-zones">
        {state.zones.map((z) => (
          <ZoneCard
            key={z.zone}
            zone={z}
            onAction={requestAction}
            busy={busy}
          />
        ))}
      </div>

      {pendingAction && (
        <div className="backup-overlay" onClick={cancelAction}>
          <div
            className="encryption-confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="encryption-confirm-title">
              {pendingAction.target === 'encrypt' ? 'Encrypt' : 'Decrypt'}{' '}
              {ZONE_LABEL[pendingAction.zone].toLowerCase()}?
            </div>
            <div className="encryption-confirm-body">
              {pendingAction.target === 'encrypt' ? (
                <>
                  This will start a backgrounded sweep that rewrites every file
                  in the zone as an encryption envelope. Reads stay transparent
                  during the sweep; the API keeps serving plaintext.
                  {pendingAction.zone === 'shared' && (
                    <div className="encryption-confirm-warning">
                      ⚠ When the shared vault is encrypted, anyone reading the
                      disk directly (e.g. Obsidian) will not be able to open
                      files. The Obsidian plugin (which uses the API) keeps
                      working.
                    </div>
                  )}
                </>
              ) : (
                <>
                  This will start a backgrounded sweep that rewrites every file
                  in the zone as plaintext. The KEK is no longer required to
                  read the files on disk after the sweep completes.
                </>
              )}
            </div>
            <div className="encryption-confirm-actions">
              <button
                className="backup-confirm-btn"
                onClick={confirmAction}
                disabled={busy}
              >
                {busy ? 'Starting…' : `Confirm ${pendingAction.target}`}
              </button>
              <button className="backup-cancel-btn" onClick={cancelAction}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
