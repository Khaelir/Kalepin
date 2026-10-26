import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDomainAllowlist, isEmailDomainAllowed } from './domain-allowlist';

describe('parseDomainAllowlist', () => {
  it('returns ["*"] when input is undefined', () => {
    assert.deepEqual(parseDomainAllowlist(undefined), ['*']);
  });

  it('returns ["*"] when input is empty', () => {
    assert.deepEqual(parseDomainAllowlist(''), ['*']);
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

  it('lower-cases entries', () => {
    assert.deepEqual(parseDomainAllowlist(' Company.com ,PARTNER.org'), ['company.com', 'partner.org']);
  });

  it('drops empty entries', () => {
    assert.deepEqual(parseDomainAllowlist('acme.com,, ,partner.org,'), ['acme.com', 'partner.org']);
  });

  it('returns an empty list when every entry is empty', () => {
    assert.deepEqual(parseDomainAllowlist(' , ,'), []);
  });
});

describe('isEmailDomainAllowed', () => {
  it('allows any email when allowlist is wildcard', () => {
    assert.equal(isEmailDomainAllowed('anyone@anywhere.org', ['*']), true);
  });

  it('treats "*" among other entries as a wildcard', () => {
    assert.equal(isEmailDomainAllowed('anyone@anywhere.org', parseDomainAllowlist('acme.com, *')), true);
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

  it('matches a mixed-case allowlist entry against a canonical email', () => {
    assert.equal(isEmailDomainAllowed('alice@company.com', parseDomainAllowlist(' Company.com ')), true);
  });

  it('compares the email domain case-insensitively', () => {
    assert.equal(isEmailDomainAllowed('alice@Company.COM', ['company.com']), true);
  });

  it('blocks everything when the allowlist is empty', () => {
    assert.equal(isEmailDomainAllowed('alice@acme.com', []), false);
  });

  it('blocks a value without "@"', () => {
    assert.equal(isEmailDomainAllowed('acme.com', ['acme.com']), false);
  });
});
