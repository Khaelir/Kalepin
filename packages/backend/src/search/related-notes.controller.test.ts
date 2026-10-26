import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { RelatedNotesController } from './related-notes.controller';
import { PinLockedException } from '../pin';

const BOB = 'bob@example.com';

function makeController(opts: { readable?: boolean; pinLocked?: boolean } = {}) {
  const calls: { path: string; opts: unknown }[] = [];
  const order: string[] = [];
  const service = {
    async findRelated(path: string, o: unknown) {
      calls.push({ path, opts: o });
      return { available: true, items: [] };
    },
  };
  const visibility = {
    async assertReadableBy() {
      order.push('visibility');
      if (opts.readable === false) throw new NotFoundException();
    },
  };
  const pin = {
    async assertUnlockedForRequest(_req: unknown, path: string) {
      order.push('pin');
      if (opts.pinLocked) throw new PinLockedException(path);
    },
  };
  const controller = new RelatedNotesController(service as any, visibility as any, pin as any);
  return { controller, calls, order };
}

const req = { user: { sub: 1, email: BOB }, headers: {} } as any;

describe('RelatedNotesController', () => {
  it('rejects a request without a path', async () => {
    const { controller, calls } = makeController();
    await assert.rejects(controller.related(undefined, undefined, req), BadRequestException);
    assert.equal(calls.length, 0);
  });

  it('passes the caller and a clamped limit to the service', async () => {
    const { controller, calls } = makeController();
    await controller.related('Notes/a.md', '50', req);
    await controller.related('Notes/a.md', 'abc', req);
    await controller.related('Notes/a.md', '3', req);
    assert.deepEqual(calls.map((c) => c.opts), [
      { limit: 20, userEmail: BOB },
      { limit: 5, userEmail: BOB },
      { limit: 3, userEmail: BOB },
    ]);
  });

  it('404s an unreadable note before consulting its PIN', async () => {
    const { controller, calls, order } = makeController({ readable: false, pinLocked: true });
    await assert.rejects(controller.related('_users/alice@example.com/a.md', undefined, req), NotFoundException);
    assert.deepEqual(order, ['visibility']);
    assert.equal(calls.length, 0);
  });

  it('423s a PIN-locked note without computing anything', async () => {
    const { controller, calls } = makeController({ pinLocked: true });
    await assert.rejects(controller.related('Notes/locked.md', undefined, req), (err: unknown) => {
      assert.ok(err instanceof PinLockedException);
      assert.equal(err.getStatus(), HttpStatus.LOCKED);
      return true;
    });
    assert.equal(calls.length, 0);
  });
});
