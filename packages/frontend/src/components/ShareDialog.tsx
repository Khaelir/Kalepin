import React, { useState, useMemo, useEffect, useCallback } from 'react';
import * as api from '../api';
import type { DocumentGrantInfo, ShareLinkInfo, AccessSummary } from '../api';
import { buildShareLinkUrl } from '../urls';
import { isE2EEncrypted } from '../crypto/path-predicates';

interface ShareDialogProps {
  /** Path being shared. For folders, `targetPaths` lists the descendants. */
  path: string;
  /** Folder mode — list of file paths to mint individual grants for. */
  targetPaths?: string[];
  /** True if `path` is a folder (the dialog shows the file checklist). */
  isFolder: boolean;
  /** Canonical email of the viewer. Used to render "Created by you" vs.
   * "Created by alice@…" on the public-link panel and to gate the Revoke
   * button (only the creator or an admin can revoke). */
  currentUserEmail: string;
  /** Whether the viewer is in ADMIN_EMAILS. Admins bypass the creator gate. */
  isAdmin: boolean;
  /** Whether this path currently has a PIN gate. Surfaces an affordance in
   * the public-link panel to add/manage the PIN. */
  hasPin?: boolean;
  /** Open the PinDialog for this path (set / change). The host wires this
   * to the same flow the file-tree context menu uses. */
  onManagePin?: () => void;
  onClose: () => void;
  onShared: (count: number) => void;
  /** Notified when a public-link code is minted. The host (App) uses this to
   * upgrade the URL bar from `/doc/<path>` to `/s/<code>/<cosmetic-path>`. */
  onCodeMinted?: (code: string) => void;
}

/**
 * Compact relative formatter for "last viewed" timestamps. Mirrors the share
 * dialog's existing voice ("3h ago", "yesterday", "5d ago") and falls back to
 * a locale date string past a week so the UI doesn't drift into "37d ago".
 */
export function formatRelativeAgo(ts: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Render the per-grantee meta line ("· 12 views · last 3h ago" or empty-state). */
export function formatGranteeMeta(
  summary: api.AccessSummaryGrantee | undefined,
  isE2E: boolean,
  nowMs: number = Date.now(),
): { text: string; tooltip?: string } {
  if (!summary || summary.view_count === 0) {
    return { text: 'Not yet viewed' };
  }
  const verb = isE2E ? 'fetched' : summary.view_count === 1 ? 'view' : 'views';
  const last = summary.last_view_at != null ? ` · last ${formatRelativeAgo(summary.last_view_at, nowMs)}` : '';
  const text = isE2E
    ? `${summary.view_count} ${verb}${last}`
    : `${summary.view_count} ${verb}${last}`;
  const tooltip = isE2E
    ? 'Server saw ciphertext downloads — actual decryption status unknown'
    : undefined;
  return { text, tooltip };
}

function formatExpiryLabel(expiresAt: number | null): string {
  if (expiresAt === null) return 'Never';
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return 'Today';
  if (days < 30) return `In ${days}d`;
  return new Date(expiresAt).toLocaleDateString();
}

const PERMS: { value: api.GrantPermission; label: string; description: string }[] = [
  { value: 'read', label: 'Read', description: 'View only' },
  { value: 'comment', label: 'Comment', description: 'View and comment' },
  { value: 'write', label: 'Write', description: 'Full edit access' },
];

const EXPIRY_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Never' },
  { value: 24 * 60 * 60 * 1000, label: '1 day' },
  { value: 7 * 24 * 60 * 60 * 1000, label: '7 days' },
  { value: 30 * 24 * 60 * 60 * 1000, label: '30 days' },
];

const PERSONAL_PREFIX = '_users/';

/** Discriminate the public-link section's UI state from the loaded
 * ShareLinkInfo (or its absence). */
export function classifyPublicLink(
  info: ShareLinkInfo | null,
): 'none' | 'active' | 'expired' | 'revoked' {
  if (!info) return 'none';
  if (info.revoked_at !== null) return 'revoked';
  if (info.expires_at !== null && info.expires_at <= Date.now()) return 'expired';
  return 'active';
}

export function ShareDialog({
  path,
  targetPaths,
  isFolder,
  currentUserEmail,
  isAdmin,
  hasPin,
  onManagePin,
  onClose,
  onShared,
  onCodeMinted,
}: ShareDialogProps) {
  const [recipient, setRecipient] = useState('');
  const [permission, setPermission] = useState<api.GrantPermission>('read');
  const [expiryMs, setExpiryMs] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allFiles = useMemo(() => targetPaths ?? [path], [path, targetPaths]);
  const [selected, setSelected] = useState<Set<string>>(new Set(allFiles));

  // Existing shares for this file. Folder mode (multi-path mint) skips this —
  // the user is granting on many files at once and per-path management
  // happens after the dialog closes (Settings or reopen on a single file).
  const [existingGrants, setExistingGrants] = useState<DocumentGrantInfo[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [pendingGrantId, setPendingGrantId] = useState<number | null>(null);
  // Summary may be `null` when the backend doesn't expose the endpoint
  // (graceful degradation per the access-metadata spec).
  const [accessSummary, setAccessSummary] = useState<AccessSummary | null>(null);
  const isE2E = useMemo(() => isE2EEncrypted(path), [path]);

  // Public link state (single-file mode only — the public-link panel is per
  // path and the folder mode operates on many at once).
  const [publicLink, setPublicLink] = useState<ShareLinkInfo | null>(null);
  const [publicLinkLoading, setPublicLinkLoading] = useState(false);
  const [publicLinkBusy, setPublicLinkBusy] = useState(false);
  const [publicLinkError, setPublicLinkError] = useState<string | null>(null);
  const [publicLinkExpiryMs, setPublicLinkExpiryMs] = useState<number | null>(
    () => (path.startsWith(PERSONAL_PREFIX) ? 30 * 24 * 60 * 60 * 1000 : null),
  );

  const reloadGrants = useCallback(async () => {
    if (isFolder) return;
    setGrantsLoading(true);
    setGrantsError(null);
    // Fetch grants and the access summary in parallel — the summary is a
    // separate endpoint with its own authz boundary, but the dialog needs
    // both to render per-grantee meta. We tolerate the summary failing
    // (it's a hint, not a primary data source) so a 404 / error doesn't
    // block the share controls.
    try {
      const [list, summary] = await Promise.all([
        api.listGrantsForPath(path),
        api.getAccessSummary(path).catch(() => null),
      ]);
      setExistingGrants(list);
      setAccessSummary(summary);
    } catch (err) {
      setGrantsError((err as Error).message || 'Failed to load shares');
    } finally {
      setGrantsLoading(false);
    }
  }, [isFolder, path]);

  const reloadPublicLink = useCallback(async () => {
    if (isFolder) return;
    setPublicLinkLoading(true);
    setPublicLinkError(null);
    try {
      const info = await api.findShareLinkByPath(path);
      setPublicLink(info);
    } catch (err) {
      setPublicLinkError((err as Error).message || 'Failed to load public link');
    } finally {
      setPublicLinkLoading(false);
    }
  }, [isFolder, path]);

  useEffect(() => { reloadGrants(); }, [reloadGrants]);
  useEffect(() => { reloadPublicLink(); }, [reloadPublicLink]);

  const publicLinkState = classifyPublicLink(publicLink);

  async function handleMintPublicLink() {
    setPublicLinkBusy(true);
    setPublicLinkError(null);
    try {
      const { code } = await api.mintShareLink({ path, ttlMs: publicLinkExpiryMs });
      onCodeMinted?.(code);
      await reloadPublicLink();
    } catch (err) {
      setPublicLinkError((err as Error).message || 'Failed to mint share link');
    } finally {
      setPublicLinkBusy(false);
    }
  }

  async function handleToggleGuestComments(next: boolean) {
    if (!publicLink) return;
    setPublicLinkBusy(true);
    setPublicLinkError(null);
    try {
      await api.updateShareLink(publicLink.code, { allowGuestComments: next });
      await reloadPublicLink();
    } catch (err) {
      setPublicLinkError((err as Error).message || 'Failed to update share link');
    } finally {
      setPublicLinkBusy(false);
    }
  }

  async function handleCopyPublicLink() {
    if (!publicLink || publicLinkState !== 'active') return;
    const url = buildShareLinkUrl(path, publicLink.code);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // Clipboard write may be blocked; fall back to selecting the URL input.
    }
  }

  async function handleRevokePublicLink() {
    if (!publicLink) return;
    setPublicLinkBusy(true);
    setPublicLinkError(null);
    try {
      await api.revokeShareLink(publicLink.code);
      await reloadPublicLink();
    } catch (err) {
      setPublicLinkError((err as Error).message || 'Failed to revoke share link');
    } finally {
      setPublicLinkBusy(false);
    }
  }

  async function handleChangePublicLinkExpiry(nextMs: number | null) {
    setPublicLinkExpiryMs(nextMs);
    // Changing expiry on an existing active link is "revoke + re-mint with new TTL"
    if (publicLink && publicLinkState === 'active') {
      setPublicLinkBusy(true);
      setPublicLinkError(null);
      try {
        await api.revokeShareLink(publicLink.code);
        const { code } = await api.mintShareLink({ path, ttlMs: nextMs });
        onCodeMinted?.(code);
        await reloadPublicLink();
      } catch (err) {
        setPublicLinkError((err as Error).message || 'Failed to update expiry');
      } finally {
        setPublicLinkBusy(false);
      }
    }
  }

  function toggle(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const grantee = recipient.trim().toLowerCase();
    if (!grantee || !grantee.includes('@')) {
      setError('Please enter a valid email');
      return;
    }
    if (selected.size === 0) {
      setError('Select at least one file to share');
      return;
    }
    setSubmitting(true);
    const expiresAt = expiryMs == null ? null : Date.now() + expiryMs;
    let succeeded = 0;
    let lastError: string | null = null;
    for (const p of selected) {
      try {
        await api.mintGrant({ granteeEmail: grantee, path: p, permission, expiresAt });
        succeeded++;
      } catch (err) {
        lastError = (err as Error).message;
      }
    }
    setSubmitting(false);
    if (succeeded > 0) {
      onShared(succeeded);
      setRecipient('');
      // For single-file mode, refresh the existing-grants list so the new
      // share appears immediately. Folder mode closes — the user just
      // batch-granted, the dialog has nothing more to show inline.
      if (isFolder) {
        onClose();
      } else {
        reloadGrants();
      }
    }
    if (lastError && succeeded === 0) {
      setError(lastError);
    } else if (isFolder) {
      onClose();
    }
  }

  async function handleChangePermission(grantId: number, next: api.GrantPermission) {
    setPendingGrantId(grantId);
    try {
      await api.updateGrant(grantId, { permission: next });
      await reloadGrants();
    } catch (err) {
      setGrantsError((err as Error).message || 'Failed to update permission');
    } finally {
      setPendingGrantId(null);
    }
  }

  async function handleRevoke(grantId: number) {
    setPendingGrantId(grantId);
    try {
      await api.revokeGrant(grantId);
      await reloadGrants();
    } catch (err) {
      setGrantsError((err as Error).message || 'Failed to revoke');
    } finally {
      setPendingGrantId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card share-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{isFolder ? `Share "${path.split('/').pop()}/"` : `Share "${path.split('/').pop()}"`}</h3>

        {!isFolder && (
          <PublicLinkPanel
            path={path}
            state={publicLinkState}
            info={publicLink}
            loading={publicLinkLoading}
            busy={publicLinkBusy}
            error={publicLinkError}
            expiryMs={publicLinkExpiryMs}
            anonymous={accessSummary?.anonymous ?? null}
            currentUserEmail={currentUserEmail}
            isAdmin={isAdmin}
            hasPin={!!hasPin}
            onMint={handleMintPublicLink}
            onCopy={handleCopyPublicLink}
            onRevoke={handleRevokePublicLink}
            onChangeExpiry={handleChangePublicLinkExpiry}
            onToggleGuestComments={handleToggleGuestComments}
            onManagePin={onManagePin}
          />
        )}

        <form onSubmit={handleApply}>
          <label className="share-dialog-field">
            <span className="share-dialog-label">Recipient email</span>
            <input
              type="email"
              className="modal-input"
              autoFocus
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="user@example.com"
              disabled={submitting}
            />
          </label>

          <fieldset className="share-dialog-field" disabled={submitting}>
            <legend className="share-dialog-label">Permission</legend>
            <div className="share-dialog-perm-options">
              {PERMS.map((p) => (
                <label key={p.value} className="share-dialog-perm-option">
                  <input
                    type="radio"
                    name="permission"
                    value={p.value}
                    checked={permission === p.value}
                    onChange={() => setPermission(p.value)}
                  />
                  <span className="share-dialog-perm-label">{p.label}</span>
                  <span className="share-dialog-perm-desc">{p.description}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="share-dialog-field">
            <span className="share-dialog-label">Expires</span>
            <select
              className="modal-input"
              value={expiryMs ?? ''}
              onChange={(e) => setExpiryMs(e.target.value === '' ? null : Number(e.target.value))}
              disabled={submitting}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>{o.label}</option>
              ))}
            </select>
          </label>

          {isFolder && (
            <div className="share-dialog-field">
              <div className="share-dialog-label">Files to share ({selected.size}/{allFiles.length})</div>
              <ul className="share-dialog-file-list">
                {allFiles.map((p) => (
                  <li key={p}>
                    <label className="share-dialog-file-row">
                      <input
                        type="checkbox"
                        checked={selected.has(p)}
                        onChange={() => toggle(p)}
                        disabled={submitting}
                      />
                      <span>{p}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="share-dialog-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="modal-btn modal-btn-cancel" onClick={onClose} disabled={submitting}>
              {isFolder ? 'Cancel' : 'Done'}
            </button>
            <button type="submit" className="modal-btn modal-btn-confirm" disabled={submitting || !recipient.trim() || selected.size === 0}>
              {submitting ? 'Sharing…' : isFolder ? `Share ${selected.size} ${selected.size === 1 ? 'file' : 'files'}` : 'Share'}
            </button>
          </div>
        </form>

        {!isFolder && (
          <section className="share-dialog-existing">
            <h4 className="share-dialog-existing-title">
              People with access ({existingGrants.length})
            </h4>
            {grantsLoading && <div className="share-dialog-existing-empty">Loading…</div>}
            {grantsError && <div className="share-dialog-error">{grantsError}</div>}
            {!grantsLoading && existingGrants.length === 0 && !grantsError && (
              <div className="share-dialog-existing-empty">
                No one else has access yet. Add someone above.
              </div>
            )}
            {existingGrants.length > 0 && (
              <ul className="share-dialog-existing-list">
                {existingGrants.map((g) => {
                  const busy = pendingGrantId === g.id;
                  const summary = accessSummary?.grantees.find(
                    (s) => s.email === g.grantee_email.toLowerCase(),
                  );
                  const meta = accessSummary
                    ? formatGranteeMeta(summary, isE2E)
                    : null;
                  return (
                    <li key={g.id} className="share-dialog-existing-row">
                      <div className="share-dialog-existing-info">
                        <span className="share-dialog-existing-email">{g.grantee_email}</span>
                        <span className="share-dialog-existing-meta">
                          Expires: {formatExpiryLabel(g.expires_at)}
                        </span>
                        {meta && (
                          <span
                            className="share-dialog-existing-views"
                            title={meta.tooltip}
                          >
                            · {meta.text}
                          </span>
                        )}
                      </div>
                      <select
                        className="share-dialog-existing-perm"
                        value={g.permission}
                        disabled={busy}
                        onChange={(e) => handleChangePermission(g.id, e.target.value as api.GrantPermission)}
                        aria-label={`Permission for ${g.grantee_email}`}
                      >
                        {PERMS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="share-dialog-existing-revoke"
                        onClick={() => handleRevoke(g.id)}
                        disabled={busy}
                      >
                        {busy ? '…' : 'Revoke'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

interface PublicLinkPanelProps {
  path: string;
  state: 'none' | 'active' | 'expired' | 'revoked';
  info: ShareLinkInfo | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  expiryMs: number | null;
  anonymous: AccessSummary['anonymous'];
  currentUserEmail: string;
  isAdmin: boolean;
  hasPin: boolean;
  onMint: () => Promise<void>;
  onCopy: () => Promise<void>;
  onRevoke: () => Promise<void>;
  onChangeExpiry: (nextMs: number | null) => Promise<void>;
  onToggleGuestComments: (next: boolean) => Promise<void>;
  onManagePin?: () => void;
}

/** Decide whether the viewer is permitted to revoke this link.
 *
 * Mirrors the backend gate in ShareLinksController.revoke:
 * - Admins always.
 * - The link's creator (case-insensitive email match) always.
 * - Legacy auto-minted rows (createdByEmail=null) fall back to "owner of the
 *   path" — but the frontend can't trivially compute that, so we relax to
 *   "anyone authenticated" for the legacy case. The server still enforces.
 *
 * The button is purely advisory; the server is the source of truth.
 */
export function canRevokePublicLink(
  info: ShareLinkInfo | null,
  currentUserEmail: string,
  isAdmin: boolean,
): boolean {
  if (!info) return false;
  if (isAdmin) return true;
  if (info.created_by_email === null) return true;
  return info.created_by_email.toLowerCase() === currentUserEmail.toLowerCase();
}

function PublicLinkPanel({
  path,
  state,
  info,
  loading,
  busy,
  error,
  expiryMs,
  anonymous,
  currentUserEmail,
  isAdmin,
  hasPin,
  onMint,
  onCopy,
  onRevoke,
  onChangeExpiry,
  onToggleGuestComments,
  onManagePin,
}: PublicLinkPanelProps) {
  const canRevoke = canRevokePublicLink(info, currentUserEmail, isAdmin);
  const isOwnLink =
    info?.created_by_email != null &&
    info.created_by_email.toLowerCase() === currentUserEmail.toLowerCase();
  const url = info ? buildShareLinkUrl(path, info.code) : '';
  return (
    <section
      className="share-dialog-public-link"
      data-public-link-state={state}
    >
      <h4 className="share-dialog-public-link-title">Public link</h4>
      {/* "Loading…" only on first load (no data yet). A reload triggered by
          toggle/copy/revoke must NOT blank out the active panel — that's what
          caused the flash on each click. The action's own busy flag handles
          per-control disabling. */}
      {loading && !info && (
        <div className="share-dialog-public-link-empty">Loading…</div>
      )}
      {!loading && state === 'none' && (
        <div className="share-dialog-public-link-none">
          <p className="share-dialog-public-link-help">
            Anyone with this URL can read this note. They do not need an account.
          </p>
          <label className="share-dialog-field">
            <span className="share-dialog-label">Expires</span>
            <select
              className="modal-input"
              value={expiryMs ?? ''}
              onChange={(e) =>
                onChangeExpiry(e.target.value === '' ? null : Number(e.target.value))
              }
              disabled={busy}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>{o.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="modal-btn modal-btn-confirm"
            onClick={onMint}
            disabled={busy}
          >
            {busy ? 'Generating…' : 'Generate public link'}
          </button>
        </div>
      )}
      {state === 'active' && info && (
        <div className="share-dialog-public-link-active">
          <input
            type="text"
            className="modal-input share-dialog-public-link-url"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
          />
          {info.created_by_email && (
            <div className="share-dialog-public-link-creator">
              {isOwnLink
                ? 'Created by you'
                : `Created by ${info.created_by_email}`}
            </div>
          )}
          {anonymous && anonymous.resolve_count > 0 && (
            <div className="share-dialog-public-link-anonymous">
              {anonymous.resolve_count} anonymous
              {anonymous.last_resolve_at != null
                ? ` · last ${formatRelativeAgo(anonymous.last_resolve_at)}`
                : ''}
            </div>
          )}
          <div className="share-dialog-public-link-row">
            <button
              type="button"
              className="modal-btn modal-btn-confirm"
              onClick={onCopy}
              disabled={busy}
            >
              Copy
            </button>
            <label className="share-dialog-public-link-expiry">
              <span className="share-dialog-label">Expires</span>
              <select
                className="modal-input"
                value={info.expires_at == null ? '' : String(info.expires_at - Date.now())}
                onChange={(e) =>
                  onChangeExpiry(e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={busy}
              >
                <option value={info.expires_at == null ? '' : String(info.expires_at - Date.now())}>
                  {formatExpiryLabel(info.expires_at)}
                </option>
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value ?? ''}>{`Reset to ${o.label}`}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="share-dialog-existing-revoke"
              onClick={onRevoke}
              disabled={busy || !canRevoke}
              title={
                canRevoke
                  ? undefined
                  : `Only ${info.created_by_email ?? 'the creator'} or an admin can revoke this link`
              }
            >
              Revoke
            </button>
          </div>
          <label className="share-dialog-public-link-guest-comments">
            <input
              type="checkbox"
              checked={info.allow_guest_comments}
              disabled={busy || !canRevoke}
              onChange={(e) => { void onToggleGuestComments(e.target.checked); }}
            />
            <span>Allow guest comments</span>
            <span
              className="share-dialog-help-hint"
              tabIndex={0}
              role="tooltip"
              data-tooltip="Anyone with the link can comment, providing their own name and email. Guest comments are marked as unverified."
              aria-label="Anyone with the link can comment, providing their own name and email. Guest comments are marked as unverified."
            >
              ⓘ
            </span>
          </label>
          {onManagePin && (
            <div className="share-dialog-public-link-pin">
              {hasPin ? (
                <>
                  <span className="share-dialog-public-link-pin-status">
                    🔒 PIN protected — viewers must enter the PIN to see this note.
                  </span>
                  <button
                    type="button"
                    className="share-dialog-public-link-pin-btn"
                    onClick={onManagePin}
                  >
                    Change PIN
                  </button>
                </>
              ) : (
                <>
                  <span className="share-dialog-public-link-pin-status">
                    No PIN set. Anyone with the link can read.
                  </span>
                  <button
                    type="button"
                    className="share-dialog-public-link-pin-btn"
                    onClick={onManagePin}
                  >
                    Add PIN
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {state === 'expired' && info && (
        <div className="share-dialog-public-link-expired">
          <p className="share-dialog-public-link-help">
            This link expired {formatExpiryLabel(info.expires_at).toLowerCase()}. The
            URL no longer resolves.
          </p>
          <button
            type="button"
            className="modal-btn modal-btn-confirm"
            onClick={onMint}
            disabled={busy}
          >
            Generate a new link
          </button>
        </div>
      )}
      {state === 'revoked' && (
        <div className="share-dialog-public-link-revoked">
          <p className="share-dialog-public-link-help">
            The previous public link was revoked. The URL no longer resolves.
          </p>
          <button
            type="button"
            className="modal-btn modal-btn-confirm"
            onClick={onMint}
            disabled={busy}
          >
            Generate a new link
          </button>
        </div>
      )}
      {error && <div className="share-dialog-error">{error}</div>}
    </section>
  );
}
