import React, { useState, useEffect } from 'react';
import type { HistoryEntry } from '../api';
import * as api from '../api';

interface VersionHistoryPanelProps {
  activeFile: string;
  selectedVersion: HistoryEntry | null;
  onSelectVersion: (entry: HistoryEntry | null) => void;
  onRestore: (entry: HistoryEntry) => void;
  onViewVersion: (content: string, entry: HistoryEntry, partial: boolean) => void;
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function actionLabel(action: string): string {
  switch (action) {
    case 'created': return 'Created';
    case 'modified': return 'Edited';
    case 'deleted': return 'Deleted';
    default: return action;
  }
}

export function VersionHistoryPanel({
  activeFile,
  selectedVersion,
  onSelectVersion,
  onRestore,
  onViewVersion,
}: VersionHistoryPanelProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const refreshHistory = () => {
    api.fetchHistory(activeFile).then(setHistory).catch(() => {});
  };

  useEffect(() => {
    setLoading(true);
    setHistory([]);
    onSelectVersion(null);
    api.fetchHistory(activeFile)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [activeFile]);

  const handleSelectEntry = async (entry: HistoryEntry) => {
    if (selectedVersion?.id === entry.id) {
      onSelectVersion(null);
      onViewVersion('', entry, false); // Signal to clear preview
      return;
    }
    onSelectVersion(entry);
    setLoadingVersion(true);
    setShowConfirm(false);
    try {
      const vc = await api.fetchVersion(activeFile, entry.id);
      onViewVersion(vc.content, entry, vc.partial);
    } catch {
      onSelectVersion(null);
    } finally {
      setLoadingVersion(false);
    }
  };

  const handleRestore = () => {
    if (!selectedVersion) return;
    onRestore(selectedVersion);
    setShowConfirm(false);
    onSelectVersion(null);
    // Refresh history after restore to show the new auto-snapshot entry
    setTimeout(refreshHistory, 1000);
  };

  return (
    <div className="version-history-panel">
      {loading ? (
        <p className="version-history-loading">Loading history...</p>
      ) : history.length === 0 ? (
        <p className="version-history-empty">No history available</p>
      ) : (
        <>
          <div className="version-history-list">
            {history.map((entry) => (
              <div
                key={entry.id}
                className={`version-history-entry${selectedVersion?.id === entry.id ? ' selected' : ''}`}
                onClick={() => handleSelectEntry(entry)}
              >
                <div className="version-entry-meta">
                  <span className={`version-action version-action-${entry.action}`}>
                    {actionLabel(entry.action)}
                  </span>
                  <span className="version-time">{relativeTime(entry.createdAt)}</span>
                </div>
                {entry.userEmail && (
                  <div className="version-user">{entry.userEmail.split('@')[0]}</div>
                )}
              </div>
            ))}
          </div>

          {selectedVersion && (
            <div className="version-detail">
              <div className="version-detail-header">
                <span>{actionLabel(selectedVersion.action)} by {selectedVersion.userEmail?.split('@')[0] || 'unknown'}</span>
                <span className="version-detail-time">{new Date(selectedVersion.createdAt).toLocaleString()}</span>
              </div>

              {loadingVersion ? (
                <p className="version-history-loading">Reconstructing version...</p>
              ) : (
                <div className="version-actions">
                  {!showConfirm ? (
                    <button
                      className="version-restore-btn"
                      onClick={() => setShowConfirm(true)}
                    >
                      Restore this version
                    </button>
                  ) : (
                    <div className="version-confirm">
                      <span>Replace current content?</span>
                      <button className="version-confirm-yes" onClick={handleRestore}>Restore</button>
                      <button className="version-confirm-no" onClick={() => setShowConfirm(false)}>Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
