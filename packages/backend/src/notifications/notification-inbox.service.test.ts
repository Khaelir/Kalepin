import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InboxNotification } from '../entities/inbox-notification.entity';
import { User } from '../entities/user.entity';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocumentGrant } from '../entities/document-grant.entity';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { GrantsService } from '../grants/grants.service';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { NotificationInboxService, RecordInput } from './notification-inbox.service';
import { NotificationRetentionService, notificationRetentionDays } from './notification-retention.service';
import { buildSnippet } from './notification-snippet';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';
const DAY = 24 * 60 * 60 * 1000;

let ds: DataSource;
let inbox: NotificationInboxService;
let handles: DocHandlesService;
let grants: GrantsService;
let missing: Set<string>;
let changed: string[];

async function setup() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [InboxNotification, User, DocHandle, DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  handles = new DocHandlesService(ds.getRepository(DocHandle));
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  missing = new Set();
  const storage = { exists: async (p: string) => !missing.has(p) } as any;
  inbox = new NotificationInboxService(
    ds.getRepository(InboxNotification),
    ds.getRepository(User),
    ds.getRepository(DocHandle),
    handles,
    new GrantAwareVisibility(grants),
    storage,
  );
  changed = [];
  inbox.onChanged((email) => changed.push(email));
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

function mention(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    type: 'comment_mention',
    recipientEmail: BOB,
    actorEmail: ALICE,
    path: 'Notes/Plan.md',
    threadId: 't1',
    commentId: `c-${Math.random()}`,
    snippet: 'Hey @[bob](bob@example.com) look',
    ...overrides,
  };
}

describe('NotificationInboxService.record', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('stores the event with actor, recipient, path, thread, snippet and handle', async () => {
    const row = await inbox.record(mention({ commentId: 'c1' }));
    assert.ok(row);
    assert.equal(row!.recipientEmail, BOB);
    assert.equal(row!.actorEmail, ALICE);
    assert.equal(row!.type, 'comment_mention');
    assert.equal(row!.path, 'Notes/Plan.md');
    assert.equal(row!.threadId, 't1');
    assert.equal(row!.commentId, 'c1');
    assert.equal(row!.snippet, 'Hey @bob look');
    assert.equal(row!.readAt, null);
    assert.equal(row!.handleId, await handles.forPath('Notes/Plan.md'));
    assert.deepEqual(changed, [BOB]);
  });

  it('canonicalizes emails', async () => {
    const row = await inbox.record(mention({ recipientEmail: 'Bob@Example.COM', actorEmail: ' ALICE@example.com ' }));
    assert.equal(row!.recipientEmail, BOB);
    assert.equal(row!.actorEmail, ALICE);
  });

  it('never notifies the actor themselves', async () => {
    assert.equal(await inbox.record(mention({ recipientEmail: 'BOB@example.com', actorEmail: BOB })), null);
    assert.equal(await ds.getRepository(InboxNotification).count(), 0);
    assert.deepEqual(changed, []);
  });

  it('suppresses a mention in someone else\'s personal note (non-owner recipient)', async () => {
    const row = await inbox.record(mention({ path: `_users/${ALICE}/diary.md` }));
    assert.equal(row, null);
  });

  it('suppresses a thread reply in someone else\'s personal note', async () => {
    const row = await inbox.record(mention({ type: 'thread_reply', path: `_users/${ALICE}/diary.md` }));
    assert.equal(row, null);
  });

  it('notifies the owner of a personal note', async () => {
    const row = await inbox.record(mention({ recipientEmail: ALICE, actorEmail: BOB, path: `_users/${ALICE}/diary.md` }));
    assert.ok(row);
  });

  it('does not apply the cross-personal rule to shares', async () => {
    const row = await inbox.record({ type: 'share', recipientEmail: BOB, actorEmail: ALICE, path: `_users/${ALICE}/plan.md` });
    assert.ok(row);
    assert.equal(row!.snippet, null);
  });

  it('drops invalid emails', async () => {
    assert.equal(await inbox.record(mention({ recipientEmail: 'not-an-email' })), null);
  });

  it('creates one item per recipient per comment', async () => {
    assert.ok(await inbox.record(mention({ commentId: 'c1' })));
    assert.equal(await inbox.record(mention({ commentId: 'c1', type: 'thread_reply' })), null);
    assert.ok(await inbox.record(mention({ commentId: 'c1', recipientEmail: CAROL })));
  });

  it('skips a doc mention while an unread one exists for the same note', async () => {
    const doc = { type: 'doc_mention' as const, recipientEmail: BOB, actorEmail: ALICE, path: 'Notes/Plan.md', heading: 'intro' };
    const first = await inbox.record(doc);
    assert.ok(first);
    assert.equal(await inbox.record(doc), null);
    await inbox.markRead(BOB, first!.id);
    assert.ok(await inbox.record(doc), 'a new mention after reading creates a new item');
  });

  it('stores no snippet for end-to-end encrypted paths', async () => {
    const row = await inbox.record(mention({ recipientEmail: ALICE, actorEmail: BOB, path: `_users/${ALICE}/_secure/x.md` }));
    assert.ok(row);
    assert.equal(row!.snippet, null);
  });
});

describe('buildSnippet', () => {
  it('collapses mention markup and whitespace', () => {
    assert.equal(buildSnippet('Hi  @[bob](bob@x.com)\n\nand @[Carol Q](carol@x.com)!', 'a.md'), 'Hi @bob and @Carol Q!');
  });

  it('truncates to 160 chars with an ellipsis', () => {
    const s = buildSnippet('x'.repeat(400), 'a.md')!;
    assert.equal(s.length, 160);
    assert.ok(s.endsWith('…'));
  });

  it('returns null for empty text and E2E paths', () => {
    assert.equal(buildSnippet('   ', 'a.md'), null);
    assert.equal(buildSnippet(undefined, 'a.md'), null);
    assert.equal(buildSnippet('secret', `_users/${ALICE}/_secure/a.md`), null);
  });
});

describe('NotificationInboxService.list', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns newest first with an id cursor', async () => {
    for (let i = 1; i <= 30; i++) await inbox.record(mention({ path: `Notes/n${i}.md`, commentId: `c${i}` }));
    const page1 = await inbox.list(BOB, { limit: 20 });
    assert.equal(page1.items.length, 20);
    assert.equal(page1.items[0].path, 'Notes/n30.md');
    assert.equal(page1.items[19].path, 'Notes/n11.md');
    assert.equal(page1.nextBefore, page1.items[19].id);
    const page2 = await inbox.list(BOB, { limit: 20, before: page1.nextBefore! });
    assert.equal(page2.items.length, 10);
    assert.equal(page2.items[0].path, 'Notes/n10.md');
    assert.equal(page2.nextBefore, null);
  });

  it('caps the page size at 50', async () => {
    for (let i = 1; i <= 55; i++) await inbox.record(mention({ path: `Notes/n${i}.md`, commentId: `c${i}` }));
    const page = await inbox.list(BOB, { limit: 500 });
    assert.equal(page.items.length, 50);
    assert.ok(page.nextBefore);
  });

  it('keeps scanning past filtered rows to fill the page', async () => {
    for (let i = 1; i <= 5; i++) await inbox.record(mention({ path: `Notes/old${i}.md`, commentId: `o${i}` }));
    // Shares on carol's personal notes without an active grant: invisible to bob.
    for (let i = 1; i <= 50; i++) {
      await inbox.record({ type: 'share', recipientEmail: BOB, actorEmail: CAROL, path: `_users/${CAROL}/p${i}.md` });
    }
    for (let i = 1; i <= 5; i++) await inbox.record(mention({ path: `Notes/new${i}.md`, commentId: `n${i}` }));

    const page1 = await inbox.list(BOB, { limit: 8 });
    assert.deepEqual(
      page1.items.map((i) => i.path),
      ['Notes/new5.md', 'Notes/new4.md', 'Notes/new3.md', 'Notes/new2.md', 'Notes/new1.md', 'Notes/old5.md', 'Notes/old4.md', 'Notes/old3.md'],
    );
    assert.ok(page1.nextBefore);
    const page2 = await inbox.list(BOB, { limit: 8, before: page1.nextBefore! });
    assert.deepEqual(page2.items.map((i) => i.path), ['Notes/old2.md', 'Notes/old1.md']);
    assert.equal(page2.nextBefore, null);
    assert.equal(await inbox.unreadCount(BOB), 10);
  });

  it('only returns the caller\'s own items', async () => {
    await inbox.record(mention());
    assert.equal((await inbox.list(CAROL)).items.length, 0);
    assert.equal(await inbox.unreadCount(CAROL), 0);
  });

  it('includes actor display names when set', async () => {
    await ds.getRepository(User).save({ email: ALICE, displayName: 'Alice A.' });
    await inbox.record(mention());
    const [item] = (await inbox.list(BOB)).items;
    assert.equal(item.actorName, 'Alice A.');
    assert.equal(item.actorEmail, ALICE);
  });

  it('skips items whose grant was revoked and stops counting them', async () => {
    const path = `_users/${ALICE}/plan.md`;
    const grant = await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path, permission: 'read' });
    await inbox.record({ type: 'share', recipientEmail: BOB, actorEmail: ALICE, path });
    assert.equal((await inbox.list(BOB)).items.length, 1);
    assert.equal(await inbox.unreadCount(BOB), 1);

    await grants.revoke(grant.id);
    assert.equal((await inbox.list(BOB)).items.length, 0);
    assert.equal(await inbox.unreadCount(BOB), 0);
  });

  it('skips items whose grant expired', async () => {
    const path = `_users/${ALICE}/plan.md`;
    await grants.mint({ grantorEmail: ALICE, granteeEmail: BOB, path, permission: 'read', expiresAt: Date.now() - 1 });
    await inbox.record({ type: 'share', recipientEmail: BOB, actorEmail: ALICE, path });
    assert.equal((await inbox.list(BOB)).items.length, 0);
  });

  it('marks items for deleted notes unavailable instead of failing', async () => {
    await inbox.record(mention({ path: 'Notes/Gone.md', commentId: 'g' }));
    await inbox.record(mention({ path: 'Notes/Missing.md', commentId: 'm' }));
    await inbox.record(mention({ path: 'Notes/Here.md', commentId: 'h' }));
    await handles.tombstoneByPath('Notes/Gone.md');
    missing.add('Notes/Missing.md');

    const items = (await inbox.list(BOB)).items;
    const byPath = Object.fromEntries(items.map((i) => [i.path, i.available]));
    assert.deepEqual(byPath, { 'Notes/Gone.md': false, 'Notes/Missing.md': false, 'Notes/Here.md': true });
  });

  it('treats a vanished handle row as unavailable', async () => {
    const row = await inbox.record(mention());
    await ds.getRepository(DocHandle).delete({ id: row!.handleId! });
    const [item] = (await inbox.list(BOB)).items;
    assert.equal(item.available, false);
    assert.equal(item.path, 'Notes/Plan.md');
  });
});

describe('NotificationInboxService — paths follow renames', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('follows a file rename and persists the new path', async () => {
    const row = await inbox.record(mention());
    await handles.updatePathByPath('Notes/Plan.md', 'Notes/Roadmap.md');
    const [item] = (await inbox.list(BOB)).items;
    assert.equal(item.path, 'Notes/Roadmap.md');
    assert.equal(item.available, true);
    const stored = await ds.getRepository(InboxNotification).findOneBy({ id: row!.id });
    assert.equal(stored!.path, 'Notes/Roadmap.md');
  });

  it('follows a folder move', async () => {
    await inbox.record(mention({ path: 'Projects/A/spec.md' }));
    await inbox.record(mention({ path: 'Projects/A/sub/deep.md' }));
    await handles.updatePathPrefix('Projects/A', 'Archive/A');
    const paths = (await inbox.list(BOB)).items.map((i) => i.path).sort();
    assert.deepEqual(paths, ['Archive/A/spec.md', 'Archive/A/sub/deep.md']);
  });

  it('applies visibility to the new path', async () => {
    // Bob's item is on a shared note that then moves into alice's personal
    // folder: bob can no longer see it.
    await inbox.record(mention({ path: 'Notes/Plan.md' }));
    await handles.updatePathByPath('Notes/Plan.md', `_users/${ALICE}/Plan.md`);
    assert.equal((await inbox.list(BOB)).items.length, 0);
    assert.equal(await inbox.unreadCount(BOB), 0);
  });

  it('drops the stored snippet when the note moves into _secure/', async () => {
    const row = await inbox.record(mention({ recipientEmail: ALICE, actorEmail: BOB, path: `_users/${ALICE}/n.md` }));
    assert.equal(row!.snippet, 'Hey @bob look');
    await handles.updatePathByPath(`_users/${ALICE}/n.md`, `_users/${ALICE}/_secure/n.md`);
    const [item] = (await inbox.list(ALICE)).items;
    assert.equal(item.path, `_users/${ALICE}/_secure/n.md`);
    assert.equal(item.snippet, null);
    const stored = await ds.getRepository(InboxNotification).findOneBy({ id: row!.id });
    assert.equal(stored!.snippet, null);
  });
});

describe('NotificationInboxService — read state', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('markRead sets readAt and lowers the unread count', async () => {
    const a = await inbox.record(mention());
    await inbox.record(mention());
    assert.equal(await inbox.unreadCount(BOB), 2);
    changed = [];
    await inbox.markRead(BOB, a!.id, 1234);
    assert.equal(await inbox.unreadCount(BOB), 1);
    const stored = await ds.getRepository(InboxNotification).findOneBy({ id: a!.id });
    assert.equal(stored!.readAt, 1234);
    assert.deepEqual(changed, [BOB]);
  });

  it('markRead is idempotent', async () => {
    const a = await inbox.record(mention());
    await inbox.markRead(BOB, a!.id, 1);
    await inbox.markRead(BOB, a!.id, 2);
    const stored = await ds.getRepository(InboxNotification).findOneBy({ id: a!.id });
    assert.equal(stored!.readAt, 1);
  });

  it('another user\'s id is a 404 and leaves the item unread', async () => {
    const a = await inbox.record(mention());
    await assert.rejects(() => inbox.markRead(CAROL, a!.id), NotFoundException);
    await assert.rejects(() => inbox.markRead(BOB, 999_999), NotFoundException);
    await assert.rejects(() => inbox.markRead(BOB, -1), NotFoundException);
    assert.equal(await inbox.unreadCount(BOB), 1);
  });

  it('markAllRead only touches the caller\'s items', async () => {
    await inbox.record(mention());
    await inbox.record(mention());
    await inbox.record(mention({ recipientEmail: CAROL }));
    assert.equal(await inbox.markAllRead(BOB), 2);
    assert.equal(await inbox.unreadCount(BOB), 0);
    assert.equal(await inbox.unreadCount(CAROL), 1);
    assert.equal(await inbox.markAllRead(BOB), 0);
  });
});

describe('Notification retention', () => {
  beforeEach(setup);
  afterEach(() => {
    delete process.env.NOTIFICATION_RETENTION_DAYS;
    return teardown();
  });

  it('deletes read items older than the cutoff and keeps unread ones', async () => {
    const now = Date.now();
    const oldRead = await inbox.record(mention(), now - 91 * DAY);
    await inbox.markRead(BOB, oldRead!.id, now - 90 * DAY);
    const oldUnread = await inbox.record(mention(), now - 200 * DAY);
    const recentRead = await inbox.record(mention(), now - 10 * DAY);
    await inbox.markRead(BOB, recentRead!.id, now);

    const retention = new NotificationRetentionService(inbox);
    assert.equal(await retention.prune(now), 1);
    const ids = (await ds.getRepository(InboxNotification).find()).map((r) => r.id).sort();
    assert.deepEqual(ids, [oldUnread!.id, recentRead!.id].sort());
  });

  it('is disabled by NOTIFICATION_RETENTION_DAYS=0', async () => {
    const now = Date.now();
    const row = await inbox.record(mention(), now - 400 * DAY);
    await inbox.markRead(BOB, row!.id, now - 400 * DAY);
    process.env.NOTIFICATION_RETENTION_DAYS = '0';
    assert.equal(await new NotificationRetentionService(inbox).prune(now), 0);
    assert.equal(await ds.getRepository(InboxNotification).count(), 1);
  });

  it('defaults to 90 days and ignores bad values', () => {
    delete process.env.NOTIFICATION_RETENTION_DAYS;
    assert.equal(notificationRetentionDays(), 90);
    process.env.NOTIFICATION_RETENTION_DAYS = 'abc';
    assert.equal(notificationRetentionDays(), 90);
    process.env.NOTIFICATION_RETENTION_DAYS = '30';
    assert.equal(notificationRetentionDays(), 30);
  });
});
