import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LinksController } from './links.controller';

// Backlinks and unlinked mentions quote a line of each linking note. For a
// PIN-locked note that line stays hidden unless the request unlocked it, as
// in search and MCP get_links: unlinked-mentions takes any `<word>.md`, so it
// was a full-text oracle into locked notes.

const LOCKED = 'Notes/locked.md';
const OPEN = 'Notes/open.md';

const linkIndex = {
  getBacklinks: async () => [
    { sourcePath: LOCKED, lineNumber: 3, context: 'salary: 120k [[Plan]]', linkType: 'wikilink' },
    { sourcePath: OPEN, lineNumber: 1, context: 'see [[Plan]]', linkType: 'wikilink' },
  ],
  getUnlinkedMentions: async () => [
    { sourcePath: LOCKED, lineNumber: 7, context: 'the secret word is salary' },
    { sourcePath: OPEN, lineNumber: 2, context: 'no salary talk here' },
  ],
} as any;

function controller(unlocked: Set<string>): LinksController {
  const pin = {
    isUnlockedForRequest: async (_req: unknown, p: string) => p !== LOCKED || unlocked.has(p),
  } as any;
  return new LinksController(linkIndex, {} as any, pin);
}

const req = { headers: {}, user: { email: 'bob@example.com', sub: 2 } } as any;

describe('LinksController — PIN-locked linking notes', () => {
  it('backlinks keep the locked note listed but drop its line', async () => {
    const out = await controller(new Set()).getBacklinks('Plan.md', req);
    assert.deepEqual(out.map((b) => [b.sourcePath, b.context]), [[LOCKED, ''], [OPEN, 'see [[Plan]]']]);
    assert.equal(JSON.stringify(out).includes('120k'), false);
  });

  it('unlinked mentions do the same', async () => {
    const out = await controller(new Set()).getUnlinkedMentions('salary.md', req);
    assert.deepEqual(out.map((m) => [m.sourcePath, m.context]), [[LOCKED, ''], [OPEN, 'no salary talk here']]);
  });

  it('an unlocked note keeps its line', async () => {
    const out = await controller(new Set([LOCKED])).getUnlinkedMentions('salary.md', req);
    assert.equal(out[0].context, 'the secret word is salary');
  });
});
