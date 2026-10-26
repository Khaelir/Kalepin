import React, { useEffect, useState } from 'react';
import { fetchAuthProviders, ssoErrorFromUrl, ssoStartUrl, stripSsoErrorFromUrl, type AuthProvider } from '../auth';

interface LoginPageProps {
  onLogin: (email: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [ssoError, setSsoError] = useState(() => ssoErrorFromUrl() ?? '');

  useEffect(() => {
    stripSsoErrorFromUrl();
    let cancelled = false;
    fetchAuthProviders().then((list) => {
      if (!cancelled) setProviders(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A full-page navigation, not a <form>: CSP `form-action 'self'` would block
  // the start endpoint's redirect to the provider after a form submit.
  const startSso = (providerId: string) => {
    const { pathname, search, hash } = window.location;
    window.location.assign(ssoStartUrl(providerId, pathname + search + hash));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError('');
    setSsoError('');
    try {
      await onLogin(email);
      setStatus('sent');
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Failed to send magic link');
    }
  };

  if (status === 'sent') {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>Kalepin</h1>
          <div className="login-sent">
            <p>Magic link sent to <strong>{email}</strong></p>
            <p>Check your email and click the link to sign in.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Kalepin</h1>
        <p>Sign in to your workspace</p>
        {ssoError && <p className="login-error login-sso-error" role="alert">{ssoError}</p>}
        {providers.length > 0 && (
          <div className="login-providers">
            {providers.map((p) => (
              <button key={p.id} type="button" className="login-provider-button" onClick={() => startSso(p.id)}>
                Sign in with {p.label}
              </button>
            ))}
            <div className="login-divider" role="separator">
              <span>or</span>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            autoFocus
          />
          <button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending...' : 'Send Magic Link'}
          </button>
        </form>
        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}
