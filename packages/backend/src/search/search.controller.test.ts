import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SearchController } from './search.controller';

// Snippets and comment threads are note content, so REST search applies the
// PIN like a read and lists a locked note by path only.

const LOCKED = 'Notes/locked.md';

const results = [
  { path: LOCKED, snippet: 'the <mark>secret</mark> plan', score: 3, type: 'note' as const },
  { path: LOCKED, snippet: 'alice: secret reply', score: 2, type: 'comment' as const, threadId: 't1', commentAuthor: 'alice' },
  { path: 'Notes/open.md', snippet: 'not a <mark>secret</mark>', score: 1, type: 'note' as const },
];

function controller(unlocked: boolean) {
  return new SearchController(
    { search: async () => results } as any,
    { isUnlockedForRequest: async (_req: unknown, p: string) => unlocked || p !== LOCKED } as any,
  );
}

const req = { headers: {}, user: { sub: 1, email: 'bob@example.com' } } as any;

describe('SearchController — PIN gate', () => {
  it('lists a locked note once, with no snippet or thread text', async () => {
    const out = await controller(false).search('secret', req);
    assert.deepEqual(out, [
      { path: LOCKED, snippet: '', score: 3, kind: 'pin-protected' },
      results[2],
    ]);
  });

  it('returns full results when the request carries the unlock', async () => {
    assert.deepEqual(await controller(true).search('secret', req), results);
  });
});
