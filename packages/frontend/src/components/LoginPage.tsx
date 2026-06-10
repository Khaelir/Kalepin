import React, { useState } from 'react';

interface LoginPageProps {
  onLogin: (email: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError('');
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
