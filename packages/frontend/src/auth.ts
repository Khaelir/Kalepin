const TOKEN_KEY = 'kalepin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function checkTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    setToken(token);
    // Clean token from URL but preserve the path and hash
    params.delete('token');
    const remaining = params.toString();
    const cleanUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
    return token;
  }
  return getToken();
}

export async function requestMagicLink(email: string, returnTo?: string): Promise<void> {
  const res = await fetch('/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, returnTo }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.message || 'Failed to send magic link');
  }
}

export interface AuthProvider {
  id: string;
  label: string;
}

/** Enabled SSO providers. Any failure means none, so the magic-link form still shows. */
export async function fetchAuthProviders(): Promise<AuthProvider[]> {
  try {
    const res = await fetch('/api/auth/providers');
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.providers)) return [];
    return data.providers.filter(
      (p: unknown): p is AuthProvider =>
        typeof (p as AuthProvider)?.id === 'string' && typeof (p as AuthProvider)?.label === 'string',
    );
  } catch {
    return [];
  }
}

export function ssoStartUrl(providerId: string, returnTo: string): string {
  return `/api/auth/sso/${encodeURIComponent(providerId)}/start?returnTo=${encodeURIComponent(returnTo)}`;
}

const SSO_GENERIC_ERROR = 'Microsoft sign-in failed. Try again, or use the email link.';

const SSO_ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: 'Email domain not allowed',
  wrong_tenant: 'Account from another organisation',
  ambiguous_account:
    'Several Kalepin accounts match this Microsoft account. Use the email link instead, or ask an admin.',
  expired: 'Sign-in expired, please try again',
  cancelled: 'Sign-in was cancelled',
  provider_error: SSO_GENERIC_ERROR,
  unavailable: 'Microsoft sign-in is temporarily unavailable',
};

export function ssoErrorMessage(code: string): string {
  return Object.prototype.hasOwnProperty.call(SSO_ERROR_MESSAGES, code) ? SSO_ERROR_MESSAGES[code] : SSO_GENERIC_ERROR;
}

/** The message for the `sso_error` the SSO callback put in the query, if any. */
export function ssoErrorFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('sso_error');
  return code === null ? null : ssoErrorMessage(code);
}

/** Strip `sso_error` from the URL (path and hash kept), so a reload doesn't show it again. */
export function stripSsoErrorFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('sso_error')) return;
  params.delete('sso_error');
  const remaining = params.toString();
  const cleanUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash;
  window.history.replaceState(window.history.state, '', cleanUrl);
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
