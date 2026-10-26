import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildPostLoginRedirect } from './return-to';

describe('buildPostLoginRedirect', () => {
  it('adds the token to a plain path', () => {
    assert.equal(buildPostLoginRedirect('/doc/Notes.md', { token: 'JWT' }), '/doc/Notes.md?token=JWT');
    assert.equal(buildPostLoginRedirect('/', { token: 'JWT' }), '/?token=JWT');
  });

  it('keeps an existing query', () => {
    assert.equal(buildPostLoginRedirect('/search?q=plan', { token: 'JWT' }), '/search?q=plan&token=JWT');
  });

  it('puts the token before a hash route', () => {
    assert.equal(
      buildPostLoginRedirect('/#/oauth/consent?request_id=abc', { token: 'JWT' }),
      '/?token=JWT#/oauth/consent?request_id=abc',
    );
    assert.equal(
      buildPostLoginRedirect('/s/x?y=1#/oauth/consent?request_id=abc', { token: 'JWT' }),
      '/s/x?y=1&token=JWT#/oauth/consent?request_id=abc',
    );
  });

  it('carries an sso_error in the same place', () => {
    assert.equal(
      buildPostLoginRedirect('/#/oauth/consent?request_id=abc', { sso_error: 'domain_not_allowed' }),
      '/?sso_error=domain_not_allowed#/oauth/consent?request_id=abc',
    );
  });

  it('replaces a param already present in returnTo', () => {
    assert.equal(buildPostLoginRedirect('/?token=stale&x=1', { token: 'JWT' }), '/?token=JWT&x=1');
  });

  it('encodes param values', () => {
    assert.equal(buildPostLoginRedirect('/', { token: 'a&b=c#d' }), '/?token=a%26b%3Dc%23d');
  });

  it('falls back to / for hostile return paths', () => {
    for (const target of [
      undefined,
      null,
      42,
      '',
      'https://evil.example/',
      '//evil.example/',
      '/\\evil.example/',
      '/.//evil.example/',
      'javascript:alert(1)',
    ]) {
      assert.equal(buildPostLoginRedirect(target, { token: 'JWT' }), '/?token=JWT', String(target));
    }
  });
});
