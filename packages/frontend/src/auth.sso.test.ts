import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchAuthProviders, ssoErrorFromUrl, ssoErrorMessage, ssoStartUrl, stripSsoErrorFromUrl } from './auth';

function stubLocation(url: string) {
  const parsed = new URL(url, 'https://kalepin.test');
  const replaceState = vi.fn();
  (globalThis as { window?: unknown }).window = {
    location: { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { state: null, replaceState },
  };
  return replaceState;
}

const originalWindow = (globalThis as { window?: unknown }).window;
const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  globalThis.fetch = originalFetch;
});

describe('ssoStartUrl', () => {
  it('encodes the return path, including a hash route', () => {
    expect(ssoStartUrl('microsoft', '/#/oauth/consent?request_id=abc')).toBe(
      '/api/auth/sso/microsoft/start?returnTo=%2F%23%2Foauth%2Fconsent%3Frequest_id%3Dabc',
    );
  });
});

describe('ssoErrorMessage', () => {
  it('maps known codes', () => {
    expect(ssoErrorMessage('domain_not_allowed')).toBe('Email domain not allowed');
    expect(ssoErrorMessage('wrong_tenant')).toBe('Account from another organisation');
    expect(ssoErrorMessage('expired')).toBe('Sign-in expired, please try again');
    expect(ssoErrorMessage('cancelled')).toBe('Sign-in was cancelled');
    expect(ssoErrorMessage('unavailable')).toBe('Microsoft sign-in is temporarily unavailable');
  });

  it('falls back to the generic message for unknown codes', () => {
    expect(ssoErrorMessage('nope')).toBe('Microsoft sign-in failed. Try again, or use the email link.');
    expect(ssoErrorMessage('toString')).toBe('Microsoft sign-in failed. Try again, or use the email link.');
  });
});

describe('sso_error in the URL', () => {
  beforeEach(() => stubLocation('/'));

  it('reads the message without touching the URL', () => {
    const replaceState = stubLocation('/?sso_error=domain_not_allowed#/oauth/consent?request_id=abc');
    expect(ssoErrorFromUrl()).toBe('Email domain not allowed');
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('returns null without an sso_error', () => {
    stubLocation('/doc/x?y=1');
    expect(ssoErrorFromUrl()).toBeNull();
  });

  it('strips sso_error and keeps the rest of the query and the hash', () => {
    const replaceState = stubLocation('/?x=1&sso_error=expired#/oauth/consent?request_id=abc');
    stripSsoErrorFromUrl();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?x=1#/oauth/consent?request_id=abc');
  });

  it('leaves the URL alone without an sso_error', () => {
    const replaceState = stubLocation('/doc/x');
    stripSsoErrorFromUrl();
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('fetchAuthProviders', () => {
  it('returns the providers', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ providers: [{ id: 'microsoft', label: 'Microsoft' }] }))) as typeof fetch;
    expect(await fetchAuthProviders()).toEqual([{ id: 'microsoft', label: 'Microsoft' }]);
  });

  it('returns [] on an HTTP error, a network error or a malformed body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
    expect(await fetchAuthProviders()).toEqual([]);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('network');
    }) as typeof fetch;
    expect(await fetchAuthProviders()).toEqual([]);
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ providers: [{ id: 1 }, 'x'] }))) as typeof fetch;
    expect(await fetchAuthProviders()).toEqual([]);
  });
});
