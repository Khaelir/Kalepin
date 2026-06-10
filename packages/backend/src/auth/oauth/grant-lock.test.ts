import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { GrantLock } from './grant-lock';

describe('GrantLock', () => {
  it('serialises concurrent acquires on the same grant', async () => {
    const lock = new GrantLock();
    const order: string[] = [];

    const a = lock.withLock(1, async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a-end');
      return 'a';
    });
    const b = lock.withLock(1, async () => {
      order.push('b-start');
      order.push('b-end');
      return 'b';
    });

    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, 'a');
    assert.equal(rb, 'b');
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('different grant ids run in parallel', async () => {
    const lock = new GrantLock();
    const order: string[] = [];

    const a = lock.withLock(1, async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
    });
    const b = lock.withLock(2, async () => {
      order.push('b-start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('b-end');
    });

    await Promise.all([a, b]);
    // b finishes before a since it didn't have to wait
    assert.deepEqual(order, ['a-start', 'b-start', 'b-end', 'a-end']);
  });

  it('releases the lock when fn throws', async () => {
    const lock = new GrantLock();
    await assert.rejects(lock.withLock(1, async () => { throw new Error('boom'); }));
    // Subsequent acquires must succeed, not deadlock.
    const result = await lock.withLock(1, async () => 'ok');
    assert.equal(result, 'ok');
  });
});
