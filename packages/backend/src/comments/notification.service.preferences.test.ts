import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import { NotificationService, SHARE_EMAIL_WINDOW_MS } from './notification.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { verifyUnsubscribeToken } from '../notifications/unsubscribe-token';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

let ds: DataSource;
let prefs: NotificationPreferencesService;
let service: NotificationService;
let sent: any[];
const ORIG_SMTP_USER = process.env.SMTP_USER;

async function setup() {
  process.env.SMTP_USER = 'smtp-user';
  ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User], synchronize: true });
  await ds.initialize();
  await ds.getRepository(User).save([{ email: ALICE }, { email: BOB }]);
  prefs = new NotificationPreferencesService(ds.getRepository(User));
  service = new NotificationService(ds.getRepository(User), undefined, prefs);
  sent = [];
  (service as any).transporter = { sendMail: async (opts: any) => { sent.push(opts); } };
}

async function teardown() {
  if (ORIG_SMTP_USER === undefined) delete process.env.SMTP_USER;
  else process.env.SMTP_USER = ORIG_SMTP_USER;
  if (ds?.isInitialized) await ds.destroy();
}

async function sendAll(): Promise<void> {
  await service.notifyMention({ mentionedEmail: BOB, authorEmail: ALICE, commentText: 'hi', notePath: 'Notes/a.md', threadId: 't' });
  await service.notifyDocMention(BOB, ALICE, 'Notes/b.md', 'intro');
  await service.notifyThreadReply(BOB, ALICE, 'reply', 'Notes/c.md', 't', false);
  await service.notifyThreadReply(BOB, ALICE, 'direct', 'Notes/d.md', 't', true);
  await service.notifyShare(BOB, ALICE, `_users/${ALICE}/e.md`);
}

describe('NotificationService — email preference gating', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('all (default) sends every email', async () => {
    await sendAll();
    assert.equal(sent.length, 5);
  });

  it('mentions drops only thread-reply emails', async () => {
    await prefs.set(BOB, 'mentions');
    await sendAll();
    const subjects = sent.map((m) => m.subject);
    assert.equal(sent.length, 4);
    assert.ok(!subjects.some((s) => s.includes('replied in a thread')));
    assert.ok(subjects.some((s) => s.includes('shared')));
  });

  it('none sends nothing', async () => {
    await prefs.set(BOB, 'none');
    await sendAll();
    assert.equal(sent.length, 0);
  });

  it('still suppresses cross-personal mentions before looking at preferences', async () => {
    await service.notifyMention({ mentionedEmail: BOB, authorEmail: ALICE, commentText: '', notePath: `_users/${ALICE}/x.md`, threadId: 't' });
    assert.equal(sent.length, 0);
  });
});

describe('NotificationService — unsubscribe link and headers', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('every email carries a working unsubscribe link and List-Unsubscribe headers', async () => {
    await sendAll();
    for (const mail of sent) {
      const url: string = mail.list.unsubscribe.url;
      assert.match(url, /\/api\/notifications\/unsubscribe\?token=/);
      const token = decodeURIComponent(url.split('token=')[1]);
      assert.equal(verifyUnsubscribeToken(token), BOB);
      assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.ok(mail.html.includes(url), 'footer links to the same URL');
      assert.match(mail.html, /Unsubscribe from these emails/);
    }
  });
});

describe('NotificationService.notifyShare', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('names the note and links to it', async () => {
    await service.notifyShare(BOB, ALICE, `_users/${ALICE}/Q3 <plan>.md`);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, BOB);
    assert.equal(sent[0].subject, `[Kalepin] ${ALICE} shared "Q3 <plan>" with you`);
    assert.match(sent[0].html, /Q3 &lt;plan&gt;/);
    assert.match(sent[0].html, /Open note/);
    assert.match(sent[0].html, /a note was shared with you/);
  });

  it('only emails registered users', async () => {
    await service.notifyShare('stranger@example.com', ALICE, `_users/${ALICE}/x.md`);
    assert.equal(sent.length, 0);
  });

  it('sends one email per grantor → grantee per window (folder share)', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 12; i++) await service.notifyShare(BOB, ALICE, `_users/${ALICE}/f/${i}.md`, t0 + i * 10);
    assert.equal(sent.length, 1);
    await service.notifyShare(BOB, ALICE, `_users/${ALICE}/f/late.md`, t0 + SHARE_EMAIL_WINDOW_MS + 1);
    assert.equal(sent.length, 2);
  });

  it('throttles per pair, not globally', async () => {
    await ds.getRepository(User).save({ email: 'carol@example.com' });
    await service.notifyShare(BOB, ALICE, `_users/${ALICE}/x.md`, 5);
    await service.notifyShare(BOB, 'carol@example.com', '_users/carol@example.com/y.md', 6);
    await service.notifyShare(ALICE, BOB, `_users/${BOB}/z.md`, 7);
    assert.equal(sent.length, 3);
  });
});
