import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ACCESS_TOKEN_PREFIX,
  REFRESH_TOKEN_PREFIX,
  hashToken,
  mintAccessToken,
  mintRefreshToken,
  isAccessToken,
  isRefreshToken,
} from './oauth-tokens';

describe('OAuth token helpers', () => {
  it('mints access tokens with correct prefix and length', () => {
    const t = mintAccessToken();
    assert.ok(t.raw.startsWith(ACCESS_TOKEN_PREFIX));
    // 32 bytes → 43 base64url chars (no padding) + prefix length
    assert.equal(t.raw.length - ACCESS_TOKEN_PREFIX.length, 43);
    assert.equal(t.hash, hashToken(t.raw));
    assert.equal(t.hash.length, 64); // SHA-256 hex
  });

  it('mints refresh tokens with correct prefix', () => {
    const t = mintRefreshToken();
    assert.ok(t.raw.startsWith(REFRESH_TOKEN_PREFIX));
    assert.equal(isRefreshToken(t.raw), true);
    assert.equal(isAccessToken(t.raw), false);
  });

  it('mints distinct tokens', () => {
    const a = mintAccessToken();
    const b = mintAccessToken();
    assert.notEqual(a.raw, b.raw);
    assert.notEqual(a.hash, b.hash);
  });

  it('isAccessToken / isRefreshToken discriminate prefixes', () => {
    assert.equal(isAccessToken(`${ACCESS_TOKEN_PREFIX}abc`), true);
    assert.equal(isAccessToken('kp_abc'), false);
    assert.equal(isRefreshToken(`${REFRESH_TOKEN_PREFIX}xyz`), true);
    assert.equal(isRefreshToken(`${ACCESS_TOKEN_PREFIX}xyz`), false);
  });
});
