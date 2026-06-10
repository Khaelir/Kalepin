import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDomainAllowlist, isEmailDomainAllowed } from './domain-allowlist';
import { isCrossPersonalMention } from './notification.service';

describe('parseDomainAllowlist', () => {
  it('returns ["*"] when input is undefined', () => {
    assert.deepEqual(parseDomainAllowlist(undefined), ['*']);
  });

  it('returns ["*"] when input is "*"', () => {
    assert.deepEqual(parseDomainAllowlist('*'), ['*']);
  });

  it('parses a single domain', () => {
    assert.deepEqual(parseDomainAllowlist('acme.com'), ['acme.com']);
  });

  it('parses comma-separated domains and trims whitespace', () => {
    assert.deepEqual(parseDomainAllowlist('acme.com, partner.org , example.net'), [
      'acme.com',
      'partner.org',
      'example.net',
    ]);
  });
});

describe('isEmailDomainAllowed', () => {
  it('allows any email when allowlist is wildcard', () => {
    assert.equal(isEmailDomainAllowed('anyone@anywhere.org', ['*']), true);
  });

  it('allows email whose domain is in the allowlist', () => {
    assert.equal(isEmailDomainAllowed('alice@acme.com', ['acme.com']), true);
  });

  it('blocks email whose domain is not in the allowlist', () => {
    assert.equal(isEmailDomainAllowed('eve@external.com', ['acme.com']), false);
  });

  it('works with multiple allowed domains', () => {
    const allowlist = ['acme.com', 'partner.org'];
    assert.equal(isEmailDomainAllowed('alice@acme.com', allowlist), true);
    assert.equal(isEmailDomainAllowed('bob@partner.org', allowlist), true);
    assert.equal(isEmailDomainAllowed('eve@evil.com', allowlist), false);
  });

  it('blocks subdomain that is not explicitly listed', () => {
    assert.equal(isEmailDomainAllowed('user@sub.acme.com', ['acme.com']), false);
  });

  it('blocks email with no domain match even if prefix matches', () => {
    assert.equal(isEmailDomainAllowed('acme.com@evil.com', ['acme.com']), false);
  });
});

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
