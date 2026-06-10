import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../../api';
import type { DocumentGrantInfo, GrantPermission } from '../../api';

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

function formatExpiry(expiresAt: number | null): string {
  if (expiresAt === null) return 'Never';
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return 'Today';
  if (days < 30) return `In ${days}d`;
  return new Date(expiresAt).toLocaleDateString();
}

const PERM_LABEL: Record<GrantPermission, string> = {
  read: 'Read',
  comment: 'Comment',
  write: 'Write',
};

export function SharingSection() {
  const [shared, setShared] = useState<DocumentGrantInfo[]>([]);
  const [received, setReceived] = useState<DocumentGrantInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        api.listGrants('grantor'),
        api.listGrants('grantee'),
      ]);
      setShared(s);
      setReceived(r);
    } catch {
      setError('Failed to load grants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRevoke = async (id: number) => {
    setRevoking(id);
    try {
      await api.revokeGrant(id);
      await load();
    } catch (err) {
      setError((err as Error).message || 'Failed to revoke grant');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Sharing</h2>
      <p className="settings-section-desc">
        Per-file grants you've created or received. Revoking a grant removes the
        recipient's access immediately.
      </p>
      {error && <div className="settings-error">{error}</div>}
      {loading ? (
        <div className="connection-list-empty">Loading…</div>
      ) : (
        <>
          <h3 style={{ marginTop: 16, marginBottom: 8 }}>I've shared ({shared.length})</h3>
          {shared.length === 0 ? (
            <div className="connection-list-empty">You haven't shared any notes yet.</div>
          ) : (
            <div className="connection-list">
              {shared.map((g) => (
                <div key={g.id} className="connection-row">
                  <div className="connection-row-icon" aria-hidden="true">→</div>
                  <div className="connection-row-info">
                    <div className="connection-row-name">{g.path}</div>
                    <div className="connection-row-meta">
                      To {g.grantee_email} · {PERM_LABEL[g.permission]} · Expires: {formatExpiry(g.expires_at)} · Created {formatRelative(g.created_at)}
                    </div>
                  </div>
                  <div className="connection-row-actions">
                    <button
                      className="api-key-revoke-btn"
                      onClick={() => handleRevoke(g.id)}
                      disabled={revoking === g.id}
                    >
                      {revoking === g.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 style={{ marginTop: 24, marginBottom: 8 }}>Shared with me ({received.length})</h3>
          {received.length === 0 ? (
            <div className="connection-list-empty">No one has shared a note with you yet.</div>
          ) : (
            <div className="connection-list">
              {received.map((g) => (
                <div key={g.id} className="connection-row">
                  <div className="connection-row-icon" aria-hidden="true">←</div>
                  <div className="connection-row-info">
                    <div className="connection-row-name">{g.path}</div>
                    <div className="connection-row-meta">
                      From {g.grantor_email} · {PERM_LABEL[g.permission]} · Expires: {formatExpiry(g.expires_at)} · Granted {formatRelative(g.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
