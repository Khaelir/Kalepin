import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { OAuthRequestError, type OAuthAuthorizeRequest, type OAuthScopeString } from '../api';
import { LoginPage } from './LoginPage';
import { requestMagicLink } from '../auth';

// `request_id` (32 random bytes, server-issued, single-use) doubles as the
// CSRF token for the approve/deny endpoints — see openspec design.md
// Decision 21. No additional CSRF token is required even with SameSite=Lax.

type Status = 'loading' | 'ready' | 'expired' | 'error' | 'submitting' | 'unauthenticated';

const SCOPE_ORDER: OAuthScopeString[] = ['notes.read', 'notes.comment', 'notes.write'];

const SCOPE_LABEL: Record<OAuthScopeString, string> = {
  'notes.read': 'Read notes',
  'notes.comment': 'Read notes and post comments',
  'notes.write': 'Read, comment, and edit notes',
};

const SCOPE_DESCRIPTION: Record<OAuthScopeString, string> = {
  'notes.read': 'See note titles, content, and metadata.',
  'notes.comment': 'Includes read access. Lets the app post and resolve comments.',
  'notes.write': 'Includes read and comment. Lets the app create, edit, and delete notes.',
};

function highestScope(scopes: OAuthScopeString[]): OAuthScopeString {
  let best: OAuthScopeString = 'notes.read';
  for (const s of scopes) {
    if (SCOPE_ORDER.indexOf(s) > SCOPE_ORDER.indexOf(best)) best = s;
  }
  return best;
}

function permittedDowngrades(requested: OAuthScopeString[]): OAuthScopeString[] {
  const max = highestScope(requested);
  const idx = SCOPE_ORDER.indexOf(max);
  return SCOPE_ORDER.slice(0, idx + 1);
}

// Map a single chosen scope tier to the array of scope strings the backend
// accepts. The mapping mirrors design.md Decision 5 (cumulative levels).
function scopeTierToArray(tier: OAuthScopeString): OAuthScopeString[] {
  switch (tier) {
    case 'notes.read':
      return ['notes.read'];
    case 'notes.comment':
      return ['notes.read', 'notes.comment'];
    case 'notes.write':
      return ['notes.read', 'notes.comment', 'notes.write'];
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

interface OAuthConsentPageProps {
  requestId: string;
  isAuthenticated: boolean;
}

export function OAuthConsentPage({ requestId, isAuthenticated }: OAuthConsentPageProps) {
  const [status, setStatus] = useState<Status>(isAuthenticated ? 'loading' : 'unauthenticated');
  const [details, setDetails] = useState<OAuthAuthorizeRequest | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [chosenScope, setChosenScope] = useState<OAuthScopeString>('notes.read');

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const data = await api.getAuthorizeRequest(requestId);
      setDetails(data);
      setChosenScope(highestScope(data.requested_scope));
      setStatus('ready');
    } catch (err) {
      if (err instanceof OAuthRequestError) {
        if (err.status === 401) {
          setStatus('unauthenticated');
          return;
        }
        if (err.status === 410 || err.status === 404) {
          setStatus('expired');
          return;
        }
      }
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [requestId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setStatus('unauthenticated');
      return;
    }
    load();
  }, [isAuthenticated, load]);

  const handleApprove = useCallback(async () => {
    if (!details) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await api.approveAuthorization(requestId, scopeTierToArray(chosenScope));
      window.location.assign(res.redirect_to);
    } catch (err) {
      setStatus('ready');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to approve');
    }
  }, [details, requestId, chosenScope]);

  const handleDeny = useCallback(async () => {
    if (!details) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await api.denyAuthorization(requestId);
      window.location.assign(res.redirect_to);
    } catch (err) {
      setStatus('ready');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to deny');
    }
  }, [details, requestId]);

  if (status === 'unauthenticated') {
    // Reuse the existing magic-link flow. After login the magic-link return
    // brings the user back to this exact URL (consent hash + request_id).
    return (
      <LoginPage
        onLogin={async (email) => {
          await requestMagicLink(email, window.location.pathname + window.location.search + window.location.hash);
        }}
      />
    );
  }

  if (status === 'loading') {
    return (
      <div className="oauth-consent-page">
        <div className="oauth-consent-card">Loading…</div>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="oauth-consent-page">
        <div className="oauth-consent-card">
          <h1 className="oauth-consent-title">This authorization request has expired</h1>
          <p className="oauth-consent-body">
            Authorization requests are valid for 10 minutes. Please return to the application
            you were trying to connect and start the connection process again.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error' || !details) {
    return (
      <div className="oauth-consent-page">
        <div className="oauth-consent-card">
          <h1 className="oauth-consent-title">Something went wrong</h1>
          <p className="oauth-consent-body">{errorMsg || 'Could not load this authorization request.'}</p>
        </div>
      </div>
    );
  }

  const verified = details.client.verified;
  const allowedTiers = permittedDowngrades(details.requested_scope);

  return (
    <div className="oauth-consent-page">
      <div className="oauth-consent-card">
        <header className="oauth-consent-header">
          <h1 className="oauth-consent-title">Connect to Kalepin</h1>
          <p className="oauth-consent-subtitle">
            Signed in as <strong>{details.user.email}</strong>
          </p>
        </header>

        {/* Identity block: client name and redirect domain at equal prominence
            (design.md Decision 16). When the client is unverified the entire
            block is wrapped in an amber warning frame. */}
        <section className={`oauth-consent-identity ${verified ? 'oauth-consent-identity--verified' : 'oauth-consent-identity--unverified'}`}>
          <div className="oauth-consent-identity-row">
            <div className="oauth-consent-identity-label">Application</div>
            <div className="oauth-consent-identity-value">{details.client.name}</div>
          </div>
          <div className="oauth-consent-identity-row">
            <div className="oauth-consent-identity-label">Will redirect to</div>
            <div className="oauth-consent-identity-value">{details.redirect_domain}</div>
          </div>
          <div className="oauth-consent-badge-row">
            {verified ? (
              <span className="oauth-consent-badge oauth-consent-badge--verified">Verified</span>
            ) : (
              <span className="oauth-consent-badge oauth-consent-badge--unverified">Unverified</span>
            )}
          </div>
          <p className="oauth-consent-disclosure">
            {verified
              ? 'This application is on our verified-publisher list.'
              : 'This name is provided by the requesting application — verify both the name and the destination URL match the app you intended to connect.'}
          </p>
        </section>

        {details.existing_grant && (
          <p className="oauth-consent-existing">
            You previously authorised this app on {formatDate(details.existing_grant.created_at)}.
            Approving will replace that authorisation.
          </p>
        )}

        <section className="oauth-consent-scope">
          <h2 className="oauth-consent-section-title">Permission</h2>
          <p className="oauth-consent-body">
            The app is requesting <strong>{SCOPE_LABEL[highestScope(details.requested_scope)]}</strong>.
            You can grant a lower level if you prefer.
          </p>
          <div className="oauth-consent-scope-options">
            {allowedTiers.map((tier) => (
              <label key={tier} className={`oauth-consent-scope-option ${chosenScope === tier ? 'oauth-consent-scope-option--selected' : ''}`}>
                <input
                  type="radio"
                  name="scope"
                  value={tier}
                  checked={chosenScope === tier}
                  onChange={() => setChosenScope(tier)}
                />
                <span className="oauth-consent-scope-text">
                  <span className="oauth-consent-scope-label">{SCOPE_LABEL[tier]}</span>
                  <span className="oauth-consent-scope-desc">{SCOPE_DESCRIPTION[tier]}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {errorMsg && <div className="oauth-consent-error">{errorMsg}</div>}

        <div className="oauth-consent-actions">
          <button
            type="button"
            className="oauth-consent-deny"
            onClick={handleDeny}
            disabled={status === 'submitting'}
          >
            Deny
          </button>
          <button
            type="button"
            className="oauth-consent-allow"
            onClick={handleApprove}
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? 'Working…' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  );
}
