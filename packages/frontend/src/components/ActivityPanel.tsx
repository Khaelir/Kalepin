import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { AccessLogRow, AccessLogAction } from '../api';

interface ActivityPanelProps {
  activeFile: string;
}

const LIMIT = 50;

function relativeTime(tsMs: number, now: number): string {
  const diff = Math.max(0, now - tsMs);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}

function actionLabel(action: AccessLogAction): string {
  switch (action) {
    case 'view': return 'viewed';
    case 'edit': return 'edited';
    case 'comment': return 'commented';
    case 'share-link-resolved': return 'opened share link';
    case 'fetched': return 'fetched (encrypted)';
  }
}

export function ActivityPanel({ activeFile }: ActivityPanelProps) {
  const [rows, setRows] = useState<AccessLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const data = await api.fetchAccessLog(activeFile, { limit: LIMIT });
      setRows(data);
    } catch (err) {
      if (err instanceof api.AccessLogForbiddenError) {
        setForbidden(true);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [activeFile]);

  useEffect(() => { load(); }, [load]);

  // Refresh "X min ago" labels without re-querying.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (forbidden) {
    return (
      <div className="activity-panel">
        <p className="activity-empty">Access log is visible only to the owner and admins.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="activity-panel">
        <p className="activity-loading">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="activity-panel">
        <p className="activity-error">Failed to load activity: {error}</p>
      </div>
    );
  }

  return (
    <div className="activity-panel" data-testid="activity-panel">
      <div className="activity-panel-header">
        <span className="activity-panel-title">Recent activity</span>
        <button className="activity-refresh" onClick={() => load()} title="Refresh">↻</button>
      </div>
      {rows.length === 0 ? (
        <p className="activity-empty">No activity recorded yet.</p>
      ) : (
        <ul className="activity-list">
          {rows.map((r) => (
            <li key={r.id} className="activity-row">
              <span className="activity-viewer">{r.viewer_email}</span>{' '}
              <span className="activity-action">{actionLabel(r.action)}</span>{' '}
              <span className="activity-time" title={new Date(r.ts).toLocaleString()}>
                {relativeTime(r.ts, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
