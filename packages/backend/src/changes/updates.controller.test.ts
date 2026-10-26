import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { UpdatesResponse } from './change-tracking.service';
import { UpdatesController } from './updates.controller';

// Diffs are note content, so the REST feed applies the PIN like a read.

const LOCKED = 'Notes/locked.md';

function feed(): UpdatesResponse {
  const file = (path: string, diff: string) => ({
    path, action: 'created' as const, changes: 1, lastChangedAt: '', user: null, diffs: [diff], metadataOnly: false,
  });
  return {
    period: { since: null, until: '' },
    stats: { created: 2, modified: 0, deleted: 0 },
    starred: [],
    other: [{ folder: 'Notes/', files: [file(LOCKED, '+secret body'), file('Notes/open.md', '+hello')] }],
  };
}

function controller(unlocked: boolean) {
  return new UpdatesController(
    { getChangesSince: async () => feed() } as any,
    { findOneBy: async () => null } as any,
    { find: async () => [] } as any,
    { isUnlockedForRequest: async (_req: unknown, p: string) => unlocked || p !== LOCKED } as any,
  );
}

const req = { headers: {}, user: { sub: 1, email: 'bob@example.com' } } as any;

describe('UpdatesController — PIN gate', () => {
  it('nulls the diffs of a locked note and keeps the others', async () => {
    const [locked, open] = (await controller(false).getUpdates(req, '1970-01-01T00:00:00Z')).other[0].files;
    assert.deepEqual(locked.diffs, [null]);
    assert.equal(locked.pinProtected, true);
    assert.deepEqual(open.diffs, ['+hello']);
    assert.equal(open.pinProtected, undefined);
  });

  it('returns the diffs when the request carries the unlock', async () => {
    const [locked] = (await controller(true).getUpdates(req)).other[0].files;
    assert.deepEqual(locked.diffs, ['+secret body']);
  });
});
