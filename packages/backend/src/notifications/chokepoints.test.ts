import 'reflect-metadata';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import type { CommentThread, SidecarData } from '@kalepin/shared';
import { InboxNotification } from '../entities/inbox-notification.entity';
import { User } from '../entities/user.entity';
import { DocHandle } from '../entities/doc-handle.entity';
import { DocumentGrant } from '../entities/document-grant.entity';
import { DocHandlesService } from '../doc-handles/doc-handles.service';
import { GrantsService } from '../grants/grants.service';
import { GrantsController } from '../grants/grants.controller';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { CommentsService } from '../comments/comments.service';
import { DocMentionService } from '../comments/doc-mention.service';
import { extractMentions } from '../comments/extract-mentions';
import { NotificationInboxService } from './notification-inbox.service';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';
const DAVE = 'dave@example.com';
const ERIN = 'erin@example.com';
const USERS = [ALICE, BOB, CAROL, DAVE, ERIN];

let ds: DataSource;
let inbox: NotificationInboxService;
let grants: GrantsService;

async function setupInbox() {
  ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [InboxNotification, User, DocHandle, DocumentGrant],
    synchronize: true,
  });
  await ds.initialize();
  grants = new GrantsService(ds.getRepository(DocumentGrant));
  inbox = new NotificationInboxService(
    ds.getRepository(InboxNotification),
    ds.getRepository(User),
    ds.getRepository(DocHandle),
    new DocHandlesService(ds.getRepository(DocHandle)),
    new GrantAwareVisibility(grants),
    { exists: async () => true } as any,
  );
}

async function teardown() {
  if (ds?.isInitialized) await ds.destroy();
}

async function items(): Promise<InboxNotification[]> {
  return ds.getRepository(InboxNotification).find({ order: { id: 'ASC' } });
}

/** Comment notifications are fire-and-forget; wait until `check` passes. */
async function eventually(check: () => Promise<void>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50));
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

describe('chokepoint: comments', () => {
  let service: CommentsService;
  let sidecarData: Map<string, SidecarData>;
  let notification: any;
  let shouldSendResult: boolean;

  beforeEach(async () => {
    await setupInbox();
    sidecarData = new Map();
    shouldSendResult = false; // the email cooldown/dedup says no
    const sidecar = {
      read: async (p: string) => structuredClone(sidecarData.get(p) ?? { comments: {} }),
      write: async (p: string, d: SidecarData) => { sidecarData.set(p, structuredClone(d)); },
    };
    notification = {
      resolveUserId: async (email: string) => {
        const i = USERS.indexOf(email.toLowerCase());
        return i === -1 ? null : i + 1;
      },
      notifyMention: mock.fn(async () => {}),
      notifyThreadReply: mock.fn(async () => {}),
    };
    const mentionTracking = {
      shouldSend: async () => shouldSendResult,
      recordSent: async () => {},
      collectThreadParticipants: (comments: { text: string }[]) =>
        new Set(comments.flatMap((c) => extractMentions(c.text))),
    };
    service = new CommentsService(
      sidecar as any,
      { indexNoteComments: async () => {}, indexCommentEmbeddings: async () => {} } as any,
      { trackCommentAdded: () => {}, trackCommentResolved: () => {} } as any,
      notification,
      mentionTracking as any,
      { autoStarForUser: async () => {} } as any,
      inbox,
    );
  });
  afterEach(teardown);

  it('a comment mention creates an item even when the email gates say no', async () => {
    const { thread, comment } = await service.addComment('Notes/Plan.md', 'b1', ALICE, 'Hey @[bob](bob@example.com) look');
    await eventually(async () => {
      const rows = await items();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].type, 'comment_mention');
      assert.equal(rows[0].recipientEmail, BOB);
      assert.equal(rows[0].actorEmail, ALICE);
      assert.equal(rows[0].threadId, thread.id);
      assert.equal(rows[0].commentId, comment.id);
      assert.equal(rows[0].snippet, 'Hey @bob look');
    });
    assert.equal(notification.notifyMention.mock.calls.length, 0, 'no email past the cooldown gate');
  });

  it('still emails when the gates pass', async () => {
    shouldSendResult = true;
    await service.addComment('Notes/Plan.md', 'b1', ALICE, 'Hey @[bob](bob@example.com)');
    await eventually(async () => assert.equal(notification.notifyMention.mock.calls.length, 1));
    assert.equal((await items()).length, 1);
  });

  it('does not notify the author mentioning themselves', async () => {
    await service.addComment('Notes/Plan.md', 'b1', ALICE, 'note to self @[alice](alice@example.com)');
    await settle();
    assert.equal((await items()).length, 0);
  });

  it('does not notify unregistered users', async () => {
    await service.addComment('Notes/Plan.md', 'b1', ALICE, '@[zed](zed@example.com)');
    await settle();
    assert.equal((await items()).length, 0);
  });

  it('suppresses mentions in someone else\'s personal note', async () => {
    await service.addComment(`_users/${ALICE}/diary.md`, 'b1', ALICE, '@[bob](bob@example.com)');
    await settle();
    assert.equal((await items()).length, 0);
  });

  it('a reply notifies mentioned participants, earlier commenters and new mentions — not guests or the author', async () => {
    const thread: CommentThread = {
      id: 'th1',
      blockId: 'b1',
      resolved: false,
      comments: [
        { id: 'c1', author: CAROL, text: 'What do you think @[bob](bob@example.com)?', createdAt: '' },
        { id: 'c2', author: DAVE, text: 'Agreed', createdAt: '' },
        { id: 'c3', author: 'guest@example.com', authorName: 'Guest', authorVerified: false, text: 'hi', createdAt: '' },
        { id: 'c4', author: ALICE, text: 'earlier note', createdAt: '' },
      ],
    };
    sidecarData.set('Notes/Plan.md', { comments: { b1: { threads: [thread] } } } as any);

    const reply = await service.replyToThread('Notes/Plan.md', 'b1', 'th1', ALICE, 'Done, cc @[erin](erin@example.com)');
    await eventually(async () => {
      const rows = await items();
      const byRecipient = Object.fromEntries(rows.map((r) => [r.recipientEmail, r.type]));
      assert.deepEqual(byRecipient, {
        [BOB]: 'thread_reply',
        [CAROL]: 'thread_reply',
        [DAVE]: 'thread_reply',
        [ERIN]: 'comment_mention',
      });
      for (const r of rows) {
        assert.equal(r.commentId, reply.id);
        assert.equal(r.threadId, 'th1');
        assert.equal(r.snippet, 'Done, cc @erin');
      }
    });
  });

  it('reply emails still go only to mentioned participants', async () => {
    shouldSendResult = true;
    const thread: CommentThread = {
      id: 'th1',
      blockId: 'b1',
      resolved: false,
      comments: [{ id: 'c1', author: CAROL, text: 'ping @[bob](bob@example.com)', createdAt: '' }],
    };
    sidecarData.set('Notes/Plan.md', { comments: { b1: { threads: [thread] } } } as any);
    await service.replyToThread('Notes/Plan.md', 'b1', 'th1', ALICE, 'ok');
    await eventually(async () => assert.equal((await items()).length, 2));
    await settle();
    const emailed = notification.notifyThreadReply.mock.calls.map((c: any) => c.arguments[0]);
    assert.deepEqual(emailed, [BOB], 'carol (commenter only) gets the in-app item, not an email');
  });
});

// ---------------------------------------------------------------------------
// Doc mentions
// ---------------------------------------------------------------------------

describe('chokepoint: doc mentions', () => {
  let service: DocMentionService;
  let notifyDocMention: ReturnType<typeof mock.fn>;

  beforeEach(async () => {
    await setupInbox();
    notifyDocMention = mock.fn(async () => {});
    const notification = {
      resolveUserId: async (email: string) => {
        const i = USERS.indexOf(email.toLowerCase());
        return i === -1 ? null : i + 1;
      },
      resolveUserEmail: async (id: number) => USERS[id - 1] ?? null,
      notifyDocMention,
    };
    service = new DocMentionService(
      { shouldSend: async () => false, recordSent: async () => {} } as any,
      notification as any,
      { autoStarForUser: async () => {} } as any,
      inbox,
    );
  });
  afterEach(teardown);

  const ALICE_ID = 1;
  const doc = '# Intro\n\nText\n\n## Design Review\n\nPing @[bob](bob@example.com) on this\n';

  it('creates a doc_mention with the nearest heading and the line as snippet', async () => {
    await service.processDocSave('Notes/Plan.md', '# Intro\n', doc, ALICE_ID);
    const rows = await items();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'doc_mention');
    assert.equal(rows[0].recipientEmail, BOB);
    assert.equal(rows[0].actorEmail, ALICE);
    assert.equal(rows[0].heading, 'design-review');
    assert.equal(rows[0].snippet, 'Ping @bob on this');
    assert.equal(notifyDocMention.mock.calls.length, 0, 'email gates said no');
  });

  it('ignores mentions that were already in the previous content', async () => {
    await service.processDocSave('Notes/Plan.md', doc, doc + '\nmore\n', ALICE_ID);
    assert.equal((await items()).length, 0);
  });

  it('does not notify the author mentioning themselves', async () => {
    await service.processDocSave('Notes/Plan.md', '', 'hi @[alice](alice@example.com)', ALICE_ID);
    assert.equal((await items()).length, 0);
  });

  it('suppresses mentions in someone else\'s personal note', async () => {
    await service.processDocSave(`_users/${ALICE}/diary.md`, '', 'hi @[bob](bob@example.com)', ALICE_ID);
    assert.equal((await items()).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Grant mint
// ---------------------------------------------------------------------------

describe('chokepoint: grant mint', () => {
  let controller: GrantsController;
  let notifyShare: ReturnType<typeof mock.fn>;
  const PATH = `_users/${ALICE}/plan.md`;
  const req = (email: string): any => ({ user: { email, sub: 1 } });
  const predicates = {
    isEncryptedAtRest: () => false,
    isE2EEncrypted: () => false,
    shouldIndexPlaintext: () => true,
    canCollab: () => true,
    commentBodiesEncrypted: () => false,
    shareLinkMintable: () => true,
  };

  beforeEach(async () => {
    await setupInbox();
    notifyShare = mock.fn(async () => {});
    controller = new GrantsController(
      grants,
      new GrantAwareVisibility(grants),
      predicates as any,
      inbox,
      { notifyShare } as any,
    );
  });
  afterEach(teardown);

  it('a new grant creates a share item and sends the share email', async () => {
    await controller.mint({ grantee_email: 'Bob@Example.com', path: PATH, permission: 'read' }, req(ALICE));
    const rows = await items();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'share');
    assert.equal(rows[0].recipientEmail, BOB);
    assert.equal(rows[0].actorEmail, ALICE);
    assert.equal(rows[0].path, PATH);
    assert.equal(notifyShare.mock.calls.length, 1);
    assert.deepEqual(notifyShare.mock.calls[0].arguments, [BOB, ALICE, PATH]);
    assert.equal((await inbox.list(BOB)).items.length, 1, 'visible through the grant');
  });

  it('changing the permission of an active grant is silent', async () => {
    await controller.mint({ grantee_email: BOB, path: PATH, permission: 'read' }, req(ALICE));
    await controller.mint({ grantee_email: BOB, path: PATH, permission: 'write' }, req(ALICE));
    assert.equal((await items()).length, 1);
    assert.equal(notifyShare.mock.calls.length, 1);
  });

  it('re-sharing after a revoke notifies again', async () => {
    const { id } = await controller.mint({ grantee_email: BOB, path: PATH, permission: 'read' }, req(ALICE));
    await inbox.markAllRead(BOB);
    await grants.revoke(id);
    await controller.mint({ grantee_email: BOB, path: PATH, permission: 'read' }, req(ALICE));
    assert.equal((await items()).length, 2);
    assert.equal(notifyShare.mock.calls.length, 2);
  });

  it('a rejected mint notifies nobody', async () => {
    await assert.rejects(() =>
      controller.mint({ grantee_email: CAROL, path: PATH, permission: 'read' }, req(BOB)));
    assert.equal((await items()).length, 0);
    assert.equal(notifyShare.mock.calls.length, 0);
  });
});
