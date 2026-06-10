import { describe, it, expect } from 'vitest';
import {
  canRevokePublicLink,
  classifyPublicLink,
  formatGranteeMeta,
  formatRelativeAgo,
} from './ShareDialog';
import type { ShareLinkInfo, AccessSummaryGrantee } from '../api';

function info(over: Partial<ShareLinkInfo> = {}): ShareLinkInfo {
  return {
    code: 'A'.repeat(10),
    expires_at: null,
    revoked_at: null,
    created_at: 1000,
    last_resolved_at: null,
    created_by_email: 'alice@example.com',
    allow_guest_comments: false,
    ...over,
  };
}

describe('ShareDialog.classifyPublicLink — public-link panel state', () => {
  it('returns "none" when no row exists', () => {
    expect(classifyPublicLink(null)).toBe('none');
  });

  it('returns "active" for a non-expired non-revoked row with null expiry', () => {
    expect(classifyPublicLink(info())).toBe('active');
  });

  it('returns "active" for a row whose expiry is in the future', () => {
    expect(classifyPublicLink(info({ expires_at: Date.now() + 86400_000 }))).toBe('active');
  });

  it('returns "expired" for a row whose expiry is in the past', () => {
    expect(classifyPublicLink(info({ expires_at: Date.now() - 1 }))).toBe('expired');
  });

  it('returns "revoked" when revoked_at is set, regardless of expiry', () => {
    expect(classifyPublicLink(info({ revoked_at: Date.now() }))).toBe('revoked');
    expect(classifyPublicLink(info({ revoked_at: Date.now(), expires_at: Date.now() + 86400_000 }))).toBe('revoked');
  });

  it('treats revoked-AND-expired rows as "revoked" (revoked takes precedence)', () => {
    expect(
      classifyPublicLink(info({ revoked_at: Date.now() - 10, expires_at: Date.now() - 1 })),
    ).toBe('revoked');
  });
});

describe('ShareDialog.canRevokePublicLink — Revoke button gating', () => {
  it('returns false when there is no link', () => {
    expect(canRevokePublicLink(null, 'alice@example.com', false)).toBe(false);
  });

  it('admin can revoke any link', () => {
    expect(
      canRevokePublicLink(info({ created_by_email: 'alice@example.com' }), 'root@example.com', true),
    ).toBe(true);
  });

  it('creator can revoke their own link', () => {
    expect(
      canRevokePublicLink(info({ created_by_email: 'alice@example.com' }), 'alice@example.com', false),
    ).toBe(true);
  });

  it('creator match is case-insensitive', () => {
    expect(
      canRevokePublicLink(info({ created_by_email: 'Alice@Example.COM' }), 'alice@example.com', false),
    ).toBe(true);
  });

  it('non-creator non-admin cannot revoke', () => {
    expect(
      canRevokePublicLink(info({ created_by_email: 'alice@example.com' }), 'bob@example.com', false),
    ).toBe(false);
  });

  it('legacy rows (created_by_email=null) are revokable from the UI; server has the final say', () => {
    expect(
      canRevokePublicLink(info({ created_by_email: null }), 'bob@example.com', false),
    ).toBe(true);
  });
});

describe('ShareDialog.formatRelativeAgo', () => {
  const now = 1_000_000_000_000;
  it('renders sub-minute as "just now"', () => {
    expect(formatRelativeAgo(now - 30_000, now)).toBe('just now');
  });
  it('renders minutes', () => {
    expect(formatRelativeAgo(now - 5 * 60_000, now)).toBe('5m ago');
  });
  it('renders hours', () => {
    expect(formatRelativeAgo(now - 3 * 60 * 60_000, now)).toBe('3h ago');
  });
  it('renders "yesterday" for one day ago', () => {
    expect(formatRelativeAgo(now - 24 * 60 * 60_000, now)).toBe('yesterday');
  });
  it('renders multi-day under a week', () => {
    expect(formatRelativeAgo(now - 5 * 24 * 60 * 60_000, now)).toBe('5d ago');
  });
  it('falls back to a date past one week', () => {
    const out = formatRelativeAgo(now - 30 * 24 * 60 * 60_000, now);
    expect(out).not.toContain('ago');
  });
});

describe('ShareDialog.formatGranteeMeta', () => {
  const now = 1_000_000_000_000;
  function row(over: Partial<AccessSummaryGrantee> = {}): AccessSummaryGrantee {
    return {
      email: 'bob@x.com',
      view_count: 0,
      last_view_at: null,
      last_edit_at: null,
      ...over,
    };
  }

  it('zero state: undefined summary → "Not yet viewed"', () => {
    expect(formatGranteeMeta(undefined, false, now).text).toBe('Not yet viewed');
  });

  it('zero state: explicit zero count → "Not yet viewed"', () => {
    expect(formatGranteeMeta(row({ view_count: 0 }), false, now).text).toBe('Not yet viewed');
  });

  it('singular vs plural: 1 view vs N views', () => {
    expect(
      formatGranteeMeta(row({ view_count: 1, last_view_at: now - 60_000 }), false, now).text,
    ).toBe('1 view · last 1m ago');
    expect(
      formatGranteeMeta(row({ view_count: 12, last_view_at: now - 3 * 60 * 60_000 }), false, now).text,
    ).toBe('12 views · last 3h ago');
  });

  it('many views (large count) renders plural', () => {
    expect(
      formatGranteeMeta(row({ view_count: 247, last_view_at: now - 5 * 60_000 }), false, now).text,
    ).toBe('247 views · last 5m ago');
  });

  it('E2E paths render "fetched" with a tooltip', () => {
    const meta = formatGranteeMeta(
      row({ view_count: 5, last_view_at: now - 60 * 60_000 }),
      true,
      now,
    );
    expect(meta.text).toBe('5 fetched · last 1h ago');
    expect(meta.tooltip).toMatch(/ciphertext/i);
  });
});
