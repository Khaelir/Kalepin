import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotificationsController } from './notifications.controller';

function item(id: number, path: string, snippet: string | null) {
  return {
    id,
    type: 'mention',
    actorEmail: 'bob@example.com',
    actorName: 'Bob',
    path,
    threadId: null,
    commentId: null,
    heading: null,
    snippet,
    createdAt: id,
    readAt: null,
    available: true,
  };
}

describe('NotificationsController.list — PIN-locked notes', () => {
  it('blanks the snippet of a locked note without its unlock, keeps the item and other snippets', async () => {
    const lookups: string[] = [];
    const inbox = {
      list: async () => ({
        items: [
          item(3, 'Locked.md', 'secret body text'),
          item(2, 'Open.md', 'public text'),
          item(1, 'Locked.md', 'another secret comment'),
        ],
        nextBefore: null,
      }),
    } as any;
    const pinService = {
      isUnlockedForRequest: async (_req: unknown, path: string) => {
        lookups.push(path);
        return path !== 'Locked.md';
      },
    } as any;
    const controller = new NotificationsController(inbox, {} as any, pinService);

    const page = await controller.list({ user: { email: 'alice@example.com' } as any, headers: {} });

    assert.deepEqual(
      page.items.map((i) => [i.path, i.snippet]),
      [['Locked.md', null], ['Open.md', 'public text'], ['Locked.md', null]],
    );
    assert.deepEqual(lookups.sort(), ['Locked.md', 'Open.md'], 'one PIN lookup per path');
  });
});
