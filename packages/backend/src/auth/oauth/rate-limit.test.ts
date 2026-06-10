import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SlidingWindowRateLimiter } from './rate-limit';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to max in the window', () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 3 });
    assert.equal(rl.check('a', 0).allowed, true);
    assert.equal(rl.check('a', 100).allowed, true);
    assert.equal(rl.check('a', 200).allowed, true);
    assert.equal(rl.check('a', 300).allowed, false);
  });

  it('expires older hits past the window', () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 2 });
    rl.check('a', 0);
    rl.check('a', 100);
    assert.equal(rl.check('a', 200).allowed, false);
    // After the window slides past the original hits, further hits succeed.
    assert.equal(rl.check('a', 1101).allowed, true);
    assert.equal(rl.check('a', 1102).allowed, true);
    assert.equal(rl.check('a', 1103).allowed, false);
  });

  it('keys are independent', () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 1 });
    assert.equal(rl.check('a', 0).allowed, true);
    assert.equal(rl.check('b', 0).allowed, true);
    assert.equal(rl.check('a', 100).allowed, false);
    assert.equal(rl.check('b', 100).allowed, false);
  });

  it('returns retryAfterSec >= 1 when blocked', () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 5000, max: 1 });
    rl.check('x', 0);
    const r = rl.check('x', 100);
    assert.equal(r.allowed, false);
    assert.ok(r.retryAfterSec >= 1, `retryAfterSec=${r.retryAfterSec}`);
    assert.ok(r.retryAfterSec <= 5);
  });
});
