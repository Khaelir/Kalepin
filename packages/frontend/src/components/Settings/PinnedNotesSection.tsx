import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import type { PinnedNote } from '../../api';

function formatRelative(ts: number | null): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function PinnedNotesSection() {
  const [items, setItems] = useState<PinnedNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listMyPinnedNotes());
    } catch {
      setError('Failed to load pinned notes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (path: string) => {
    setRemoving(path);
    try {
      await api.removeNotePin(path);
      await load();
    } catch (err) {
      setError((err as Error).message || 'Failed to remove PIN');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Security</h2>
      <p className="settings-section-desc">
        Notes you've protected with a PIN. The PIN is a friction layer, not end-to-end
        encryption — server admins can still see content.
      </p>
      {error && <div className="settings-error">{error}</div>}
      {loading ? (
        <div className="connection-list-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="connection-list-empty">No notes have a PIN yet.</div>
      ) : (
        <div className="connection-list">
          {items.map((it) => (
            <div key={it.path} className="connection-row">
              <div className="connection-row-icon" aria-hidden="true">🔒</div>
              <div className="connection-row-info">
                <div className="connection-row-name">{it.path}</div>
                <div className="connection-row-meta">
                  PIN set {formatRelative(it.pinSetAt)}
                </div>
              </div>
              <div className="connection-row-actions">
                <button
                  className="api-key-revoke-btn"
                  onClick={() => handleRemove(it.path)}
                  disabled={removing === it.path}
                >
                  {removing === it.path ? 'Removing…' : 'Remove PIN'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
