import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ScopedTokenService } from './scoped-token.service';

describe('ScopedTokenService.mintAccessToken / verifyAccessToken', () => {
  it('round-trips (code, path) on success', () => {
    process.env.JWT_SECRET = 'test-secret-of-sufficient-length-1234';
    const svc = new ScopedTokenService();
    const { token } = svc.mintAccessToken({ code: 'C0DE000001', path: 'Notes/foo.md' });
    const verified = svc.verifyAccessToken(token);
    assert.deepEqual(verified, { code: 'C0DE000001', path: 'Notes/foo.md' });
  });

  it('returns null when the signature does not match (forged body)', () => {
    process.env.JWT_SECRET = 'test-secret-of-sufficient-length-1234';
    const svc = new ScopedTokenService();
    const { token } = svc.mintAccessToken({ code: 'C0DE000001', path: 'Notes/foo.md' });
    const dot = token.indexOf('.');
    // Swap the body for a different (code, path) but keep the original
    // signature. Verification must reject because the HMAC won't match.
    const forgedBody = Buffer.from(JSON.stringify({
      k: 'a', c: 'OTHERCODE', p: 'Notes/other.md', e: Date.now() + 60000,
    }), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const forged = forgedBody + token.slice(dot);
    assert.equal(svc.verifyAccessToken(forged), null);
  });

  it('returns null when the token is past expiry', () => {
    process.env.JWT_SECRET = 'test-secret-of-sufficient-length-1234';
    const svc = new ScopedTokenService();
    const { token } = svc.mintAccessToken({
      code: 'C0DE000001',
      path: 'Notes/foo.md',
      ttlMs: -1, // already expired
    });
    assert.equal(svc.verifyAccessToken(token), null);
  });

  it('returns null on malformed input (no dot)', () => {
    process.env.JWT_SECRET = 'test-secret-of-sufficient-length-1234';
    const svc = new ScopedTokenService();
    assert.equal(svc.verifyAccessToken('not-a-token'), null);
    assert.equal(svc.verifyAccessToken(''), null);
  });

  it('rejects an asset token presented to verifyAccessToken (kind mismatch)', () => {
    process.env.JWT_SECRET = 'test-secret-of-sufficient-length-1234';
    const svc = new ScopedTokenService();
    const { token } = svc.mintAssetToken({ code: 'C0DE000001', assetPath: 'img/x.png' });
    assert.equal(svc.verifyAccessToken(token), null);
  });

  it('expiresAt reflects the requested TTL', () => {
    process.env.JWT_SECRET = 'test-secret-of-sufficient-length-1234';
    const svc = new ScopedTokenService();
    const before = Date.now();
    const { expiresAt } = svc.mintAccessToken({
      code: 'C0DE000001',
      path: 'Notes/foo.md',
      ttlMs: 60_000,
    });
    const after = Date.now();
    assert.ok(expiresAt >= before + 60_000);
    assert.ok(expiresAt <= after + 60_000);
  });
});

describe('ScopedTokenService.mintAssetToken / verifyAssetToken', () => {
  it('round-trips (code, assetPath) on success', () => {
    process.env.JWT_SECRET = 'test-secret-of-sufficient-length-1234';
    const svc = new ScopedTokenService();
    const { token } = svc.mintAssetToken({ code: 'C0DE000001', assetPath: 'img/x.png' });
    const verified = svc.verifyAssetToken(token);
    assert.deepEqual(verified, { code: 'C0DE000001', assetPath: 'img/x.png' });
  });

  it('rejects an access token presented to verifyAssetToken (kind mismatch)', () => {
    process.env.JWT_SECRET = 'test-secret-of-sufficient-length-1234';
    const svc = new ScopedTokenService();
    const { token } = svc.mintAccessToken({ code: 'C0DE000001', path: 'Notes/foo.md' });
    assert.equal(svc.verifyAssetToken(token), null);
  });
});
