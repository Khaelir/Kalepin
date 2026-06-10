import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import type { CompletedTour, ApiKeyScope, OAuthGrantInfo } from '../api';
import { getAllTours } from '../tours/registry';
import { clearToken } from '../auth';
import { ConnectClaudeWizard } from './ConnectClaudeWizard';
import { EncryptionSettings } from './Settings/EncryptionSettings';
import { PinnedNotesSection } from './Settings/PinnedNotesSection';
import { SharingSection } from './Settings/SharingSection';
import { SecuritySettings } from './Settings/SecuritySettings';
import { SECURE_FOLDER_ENABLED } from '../feature-flags';
import { authHeaders } from '../auth';

function getCurrentEmail(): string {
  const headers = authHeaders() as Record<string, string>;
  const auth = headers['Authorization'];
  if (!auth) return '';
  try {
    const token = auth.split(' ')[1];
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.email || '';
  } catch {
    return '';
  }
}

interface SettingsPageProps {
  onBack: () => void;
  completedTours?: CompletedTour[];
  onStartTour?: (tourId: string) => void;
}

type Connection =
  | { kind: 'apikey'; id: number; name: string; scope: ApiKeyScope; createdAt: string }
  | {
      kind: 'oauth';
      id: number;
      clientName: string;
      clientId: string;
      scope: string;
      createdAt: string;
      lastUsedAt: string | null;
    };

const API_KEY_SCOPE_LABEL: Record<ApiKeyScope, string> = {
  ro: 'Read-only',
  rc: 'Read + Comments',
  rw: 'Full access',
  admin: 'Admin',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatRelativeTime(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

export function SettingsPage({ onBack, completedTours = [], onStartTour }: SettingsPageProps) {
  const [keys, setKeys] = useState<api.ApiKeyInfo[]>([]);
  const [oauthGrants, setOauthGrants] = useState<OAuthGrantInfo[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScope, setNewKeyScope] = useState<ApiKeyScope>('ro');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: number; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [userIsAdmin, setUserIsAdmin] = useState(false);
  const [showCliForm, setShowCliForm] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Backup & Restore state
  const [downloading, setDownloading] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupError, setBackupError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadConnections = useCallback(async () => {
    try {
      const [list, grants, whoami] = await Promise.all([
        api.listApiKeys(),
        api.listOAuthGrants().catch(() => [] as OAuthGrantInfo[]),
        api.fetchWhoami(),
      ]);
      setKeys(list);
      setOauthGrants(grants);
      setUserIsAdmin(whoami.isAdmin);
    } catch {
      setError('Failed to load connections');
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const result = await api.createApiKey(newKeyName.trim(), newKeyScope);
      setRevealedKey({ id: result.id, key: result.key });
      setCopied(false);
      setNewKeyName('');
      setNewKeyScope('ro');
      await loadConnections();
    } catch {
      setError('Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const mcpEndpoint = `${window.location.origin}/mcp`;
  const mcpToken = revealedKey?.key ?? '{{API_KEY}}';
  const mcpCommand = `claude mcp add kalepin --transport http ${mcpEndpoint} \\\n  --header "Authorization: Bearer ${mcpToken}"`;

  const handleCopyMcpCommand = async () => {
    try {
      await navigator.clipboard.writeText(mcpCommand);
      setCommandCopied(true);
      setTimeout(() => setCommandCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const handleRevokeApiKey = async (id: number) => {
    setError('');
    try {
      await api.revokeApiKey(id);
      if (revealedKey?.id === id) setRevealedKey(null);
      setConfirmingRevoke(null);
      await loadConnections();
    } catch {
      setError('Failed to revoke API key');
    }
  };

  const handleRevokeOAuthGrant = async (id: number) => {
    setError('');
    try {
      await api.revokeOAuthGrant(id);
      setConfirmingRevoke(null);
      await loadConnections();
    } catch {
      setError('Failed to revoke connection');
    }
  };

  const handleDownloadBackup = async () => {
    setDownloading(true);
    setBackupError('');
    try {
      await api.downloadBackup();
    } catch {
      setBackupError('Failed to download backup');
    } finally {
      setDownloading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setRestoreFile(file);
    setConfirmingRestore(false);
    setBackupError('');
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setBackupError('');
    try {
      await api.restoreBackup(restoreFile);
      setConfirmingRestore(false);
      const poll = setInterval(async () => {
        try {
          const res = await fetch('/api/health');
          if (res.ok) {
            clearInterval(poll);
            window.location.reload();
          }
        } catch {
          // server still down, keep polling
        }
      }, 2000);
    } catch (err) {
      setRestoring(false);
      setBackupError(err instanceof Error ? err.message : 'Restore failed');
    }
  };

  // Merge API keys + OAuth grants chronologically.
  const connections: Connection[] = [
    ...keys.map<Connection>((k) => ({
      kind: 'apikey',
      id: k.id,
      name: k.name,
      scope: k.scope,
      createdAt: k.createdAt,
    })),
    ...oauthGrants.map<Connection>((g) => ({
      kind: 'oauth',
      id: g.id,
      clientName: g.client_name,
      clientId: g.client_id,
      scope: g.scope,
      createdAt: g.created_at,
      lastUsedAt: g.last_used_at,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="settings-page">
      <div className="settings-content">
        <div className="settings-header">
          <button className="settings-back-btn" onClick={onBack}>
            ← Back to workspace
          </button>
          <h1 className="settings-title">Settings</h1>
        </div>

        <section className="settings-section">
          <h2 className="settings-section-title">Connections</h2>
          <p className="settings-section-desc">
            Apps and tools that have access to your Kalepin notes via the MCP API.
          </p>

          {error && <div className="settings-error">{error}</div>}

          {/* Side-by-side cards: Claude.ai (web) and Claude Code (CLI) */}
          <div className="connections-cards">
            <div className="connection-card">
              <div className="connection-card-title">Claude.ai (web)</div>
              <div className="connection-card-desc">
                Connect Kalepin as a custom connector in the Claude web app — no token paste required.
              </div>
              <button
                type="button"
                className="connection-card-action"
                onClick={() => setWizardOpen(true)}
              >
                Connect
              </button>
            </div>
            <div className="connection-card">
              <div className="connection-card-title">Claude Code (CLI)</div>
              <div className="connection-card-desc">
                Create an API key for Claude Code, custom MCP scripts, or other CLI tooling.
              </div>
              <button
                type="button"
                className="connection-card-action"
                onClick={() => setShowCliForm((v) => !v)}
              >
                {showCliForm ? 'Hide form' : '+ New API key'}
              </button>
            </div>
          </div>

          {showCliForm && (
            <>
              <form className="api-key-form" onSubmit={handleCreate}>
                <input
                  type="text"
                  className="api-key-input"
                  placeholder="Key name (e.g. MCP Server)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
                <div className="api-key-scope-picker">
                  {([
                    ['ro', 'Read-only'],
                    ['rc', 'Read + Comments'],
                    ['rw', 'Full access'],
                    ...(userIsAdmin ? [['admin', 'Admin'] as const] : []),
                  ] as [api.ApiKeyScope, string][]).map(([value, label]) => (
                    <label key={value} className="api-key-scope-option">
                      <input
                        type="radio"
                        name="scope"
                        value={value}
                        checked={newKeyScope === value}
                        onChange={() => setNewKeyScope(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  className="api-key-create-btn"
                  disabled={!newKeyName.trim() || creating}
                >
                  {creating ? 'Creating...' : 'Create Key'}
                </button>
              </form>

              {revealedKey && (
                <div className="api-key-reveal">
                  <div className="api-key-reveal-warning">
                    Make sure to copy your API key now. You won't be able to see it again.
                  </div>
                  <div className="api-key-reveal-value">
                    <code>{revealedKey.key}</code>
                    <button
                      className="api-key-copy-btn"
                      onClick={() => handleCopy(revealedKey.key)}
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              <div className="mcp-setup-box">
                <div className="mcp-setup-header">
                  <div>
                    <div className="mcp-setup-title">Add to Claude Code (MCP)</div>
                    <div className="mcp-setup-desc">
                      {revealedKey
                        ? 'Your new key is filled in below. Run this in your terminal:'
                        : 'Create a key above to auto-fill the token, or copy and replace the placeholder.'}
                    </div>
                  </div>
                  <button className="api-key-copy-btn" onClick={handleCopyMcpCommand}>
                    {commandCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="mcp-setup-cmd"><code>{`claude mcp add kalepin --transport http ${mcpEndpoint} \\`}{'\n'}{`  --header "Authorization: Bearer `}<span className={revealedKey ? 'mcp-token' : 'mcp-placeholder'}>{mcpToken}</span>{`"`}</code></pre>
              </div>
            </>
          )}

          {/* Unified connections list */}
          {connections.length === 0 ? (
            <div className="connection-list-empty">
              No connections yet. Use the cards above to connect Claude.ai or generate an API key for the CLI.
            </div>
          ) : (
            <div className="connection-list">
              {connections.map((conn) => {
                const rowKey = `${conn.kind}-${conn.id}`;
                const isConfirming = confirmingRevoke === rowKey;
                if (conn.kind === 'apikey') {
                  return (
                    <div key={rowKey} className="connection-row">
                      <div className="connection-row-icon" aria-hidden="true">▤</div>
                      <div className="connection-row-info">
                        <div className="connection-row-name">{conn.name}</div>
                        <div className="connection-row-meta">
                          API key · {API_KEY_SCOPE_LABEL[conn.scope]} · Created {formatDate(conn.createdAt)}
                        </div>
                      </div>
                      <div className="connection-row-actions">
                        {isConfirming ? (
                          <>
                            <span className="api-key-confirm-text">Are you sure?</span>
                            <button className="api-key-confirm-btn" onClick={() => handleRevokeApiKey(conn.id)}>
                              Yes, revoke
                            </button>
                            <button className="api-key-cancel-btn" onClick={() => setConfirmingRevoke(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button className="api-key-revoke-btn" onClick={() => setConfirmingRevoke(rowKey)}>
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }
                const lastUsed = formatRelativeTime(conn.lastUsedAt);
                return (
                  <div key={rowKey} className="connection-row">
                    <div className="connection-row-icon" aria-hidden="true">⛓</div>
                    <div className="connection-row-info">
                      <div className="connection-row-name">{conn.clientName}</div>
                      <div className="connection-row-meta">
                        OAuth · {conn.scope} · Authorised {formatDate(conn.createdAt)}
                        {lastUsed ? ` · Last used ${lastUsed}` : ''}
                      </div>
                    </div>
                    <div className="connection-row-actions">
                      {isConfirming ? (
                        <>
                          <span className="api-key-confirm-text">Are you sure?</span>
                          <button className="api-key-confirm-btn" onClick={() => handleRevokeOAuthGrant(conn.id)}>
                            Yes, revoke
                          </button>
                          <button className="api-key-cancel-btn" onClick={() => setConfirmingRevoke(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button className="api-key-revoke-btn" onClick={() => setConfirmingRevoke(rowKey)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {userIsAdmin && (
          <section className="settings-section">
            <h2 className="settings-section-title">Backup & Restore</h2>
            <p className="settings-section-desc">
              Download a full backup archive or restore from a previous one.
            </p>

            {backupError && <div className="settings-error">{backupError}</div>}

            <div className="backup-actions">
              <button
                className="backup-download-btn"
                onClick={handleDownloadBackup}
                disabled={downloading}
              >
                {downloading ? 'Downloading...' : 'Download Backup'}
              </button>

              <div className="backup-restore-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".tar.gz,.tgz"
                  className="backup-file-input"
                  onChange={handleFileSelect}
                />
                {restoreFile && !confirmingRestore && (
                  <button
                    className="backup-restore-btn"
                    onClick={() => setConfirmingRestore(true)}
                  >
                    Restore
                  </button>
                )}
                {confirmingRestore && (
                  <div className="backup-confirm">
                    <span className="backup-confirm-text">
                      This will replace all notes and data. Are you sure?
                    </span>
                    <button className="backup-confirm-btn" onClick={handleRestore}>
                      Confirm Restore
                    </button>
                    <button
                      className="backup-cancel-btn"
                      onClick={() => setConfirmingRestore(false)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {restoring && (
          <div className="backup-overlay">
            <div className="backup-overlay-content">
              <div className="backup-overlay-spinner" />
              <div className="backup-overlay-text">Restoring...</div>
              <div className="backup-overlay-subtext">Waiting for server to restart...</div>
            </div>
          </div>
        )}

        {userIsAdmin && <EncryptionSettings />}

        {SECURE_FOLDER_ENABLED && (
          <section className="settings-section">
            <SecuritySettings userEmail={getCurrentEmail()} />
          </section>
        )}

        <PinnedNotesSection />

        <SharingSection />

        <section className="settings-section tutorials-section">
          <h2 className="settings-section-title">Tutorials</h2>
          <p className="settings-section-desc">
            Interactive guides to help you learn Kalepin's features.
          </p>
          {getAllTours().map((tour) => {
            const completed = completedTours.find((c) => c.tourId === tour.id);
            const isComplete = completed && completed.version >= tour.version;
            return (
              <div key={tour.id} className="tutorial-item">
                {isComplete && <span className="tutorial-item-status">{'✓'}</span>}
                <div className="tutorial-item-info">
                  <div className="tutorial-item-name">{tour.name}</div>
                  <div className="tutorial-item-desc">{tour.description}</div>
                </div>
                <button
                  className="tutorial-item-btn"
                  onClick={() => onStartTour?.(tour.id)}
                >
                  {isComplete ? 'Replay' : 'Start'}
                </button>
              </div>
            );
          })}
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Account</h2>
          <button
            className="settings-logout-btn"
            onClick={() => {
              clearToken();
              window.location.reload();
            }}
          >
            Log out
          </button>
        </section>
      </div>

      {wizardOpen && <ConnectClaudeWizard onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
