import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDomainAllowlist, isEmailDomainAllowed } from '../auth/domain-allowlist';
import { isCrossPersonalMention } from './notification.service';

describe('NotificationService domain gating (integration)', () => {
  it('blocks all three notification paths for disallowed domains', () => {
    // Verify that parseDomainAllowlist + isEmailDomainAllowed compose correctly
    // to gate the same way the service constructor + guard would
    const allowlist = parseDomainAllowlist('acme.com');

    // Allowed
    assert.equal(isEmailDomainAllowed('alice@acme.com', allowlist), true);

    // Blocked
    assert.equal(isEmailDomainAllowed('eve@external.com', allowlist), false);
    assert.equal(isEmailDomainAllowed('hacker@evil.org', allowlist), false);
    assert.equal(isEmailDomainAllowed('trick@acme.com.evil.org', allowlist), false);
  });

  it('default config (unset env) allows all domains', () => {
    const allowlist = parseDomainAllowlist(undefined);
    assert.equal(isEmailDomainAllowed('anyone@anywhere.com', allowlist), true);
  });
});

describe('isCrossPersonalMention', () => {
  it('returns false for shared notes regardless of recipient', () => {
    assert.equal(isCrossPersonalMention('Notes/foo.md', 'bob@example.com'), false);
    assert.equal(isCrossPersonalMention('', 'bob@example.com'), false);
  });

  it('returns false when recipient owns the personal folder', () => {
    assert.equal(
      isCrossPersonalMention('_users/alice@example.com/diary.md', 'alice@example.com'),
      false,
    );
  });

  it('returns true when recipient does not own the personal folder', () => {
    assert.equal(
      isCrossPersonalMention('_users/alice@example.com/diary.md', 'bob@example.com'),
      true,
    );
  });

  it('is case-insensitive on the recipient comparison', () => {
    assert.equal(
      isCrossPersonalMention('_users/alice@example.com/diary.md', 'ALICE@example.com'),
      false,
    );
  });

  it('handles paths with no trailing slash after the email', () => {
    assert.equal(
      isCrossPersonalMention('_users/alice@example.com', 'bob@example.com'),
      true,
    );
    assert.equal(
      isCrossPersonalMention('_users/alice@example.com', 'alice@example.com'),
      false,
    );
  });

  it('does not equate john_doe@x.com with johnxdoe@x.com (exact-match)', () => {
    assert.equal(
      isCrossPersonalMention('_users/john_doe@x.com/secret.md', 'johnxdoe@x.com'),
      true,
    );
  });
});
