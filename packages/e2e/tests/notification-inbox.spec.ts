import { test, expect, createNote } from '../fixtures';
import jwt from 'jsonwebtoken';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';
import type { Page } from '@playwright/test';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;
const JWT_SECRET = 'test-secret';

let subCounter = 900;

function makeToken(email: string): string {
  return jwt.sign({ sub: ++subCounter, email }, JWT_SECRET, { expiresIn: '1h' });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Unique, canonical users per test so inboxes never bleed between tests. */
function users(tag: string) {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const alice = `inbox-alice-${tag}-${run}@example.com`;
  const bob = `inbox-bob-${tag}-${run}@example.com`;
  return { alice, bob, aliceToken: makeToken(alice), bobToken: makeToken(bob) };
}

/** Any authenticated call provisions the user row (mentions only notify registered users). */
async function register(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/tree`, { headers: bearer(token) });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
}

async function signIn(page: Page, token: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(BASE_URL);
  await expect(page.locator('.kp-inbox-btn')).toBeVisible({ timeout: 15_000 });
}

async function addComment(token: string, path: string, quotedText: string, text: string) {
  const res = await fetch(`${API_URL}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ path, blockId: crypto.randomUUID(), text, quotedText }),
  });
  if (!res.ok) throw new Error(`Failed to add comment: ${res.status}`);
  return res.json() as Promise<{ thread: { id: string } }>;
}

async function unreadCount(token: string): Promise<number> {
  const res = await fetch(`${API_URL}/api/notifications/unread-count`, { headers: bearer(token) });
  return (await res.json()).count;
}

const badge = (page: Page) => page.locator('.kp-inbox-badge');

test.describe('Notification inbox', () => {
  test('a comment mention shows under the bell and opens the thread', async ({ page }) => {
    const { bob, aliceToken, bobToken } = users('mention');
    const noteName = `inbox-mention-${Date.now()}.md`;
    createNote(noteName, '# Inbox test\n\nThis paragraph needs a review.\n');
    await register(aliceToken);
    await register(bobToken);

    await signIn(page, bobToken);
    await expect(badge(page)).toHaveCount(0);

    await addComment(aliceToken, noteName, 'needs a review', `Can you check this @[bob](${bob})?`);

    // Pushed over the existing /ws socket — no reload.
    await expect(badge(page)).toHaveText('1', { timeout: 10_000 });
    await expect(page.locator('.kp-inbox-btn')).toHaveAttribute('aria-label', 'Notifications, 1 unread');

    await page.locator('.kp-inbox-btn').click();
    const item = page.locator('.kp-inbox-item.is-unread');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('mentioned you in');
    await expect(item).toContainText(noteName.replace(/\.md$/, ''));
    await expect(item).toContainText(`Can you check this @bob?`);

    await item.click();

    await expect(page.locator('.kp-inbox-panel')).toHaveCount(0);
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.comments-panel')).toContainText('Can you check this', { timeout: 10_000 });
    // App.tsx highlights the navigated-to thread for ~3s.
    await expect(page.locator('.comment-thread.highlight')).toBeVisible({ timeout: 5_000 });

    await expect(badge(page)).toHaveCount(0);
    await expect.poll(() => unreadCount(bobToken)).toBe(0);
  });

  test('mark all as read clears the badge', async ({ page }) => {
    const { bob, aliceToken, bobToken } = users('markall');
    const noteName = `inbox-markall-${Date.now()}.md`;
    createNote(noteName, '# Mark all\n\nFirst paragraph.\n\nSecond paragraph.\n');
    await register(aliceToken);
    await register(bobToken);

    // Two mentions in quick succession: the email cooldown would drop the
    // second email, but both land in the inbox.
    await addComment(aliceToken, noteName, 'First paragraph', `One @[bob](${bob})`);
    await addComment(aliceToken, noteName, 'Second paragraph', `Two @[bob](${bob})`);
    await expect.poll(() => unreadCount(bobToken)).toBe(2);

    await signIn(page, bobToken);
    await expect(badge(page)).toHaveText('2');

    await page.locator('.kp-inbox-btn').click();
    await expect(page.locator('.kp-inbox-item.is-unread')).toHaveCount(2);
    await page.locator('.kp-inbox-markall').click();

    await expect(page.locator('.kp-inbox-item.is-unread')).toHaveCount(0);
    await expect(page.locator('.kp-inbox-item')).toHaveCount(2);
    await expect(badge(page)).toHaveCount(0);
    await expect.poll(() => unreadCount(bobToken)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('.kp-inbox-panel')).toHaveCount(0);
    await expect(page.locator('.kp-inbox-btn')).toBeFocused();
  });

  test('sharing a note puts a "shared with you" item in the inbox', async ({ page }) => {
    const { alice, bob, aliceToken, bobToken } = users('share');
    await register(aliceToken);
    await register(bobToken);
    const notePath = `_users/${alice}/Roadmap-${Date.now()}.md`;
    const created = await fetch(`${API_URL}/api/files/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(aliceToken) },
      body: JSON.stringify({ path: notePath, content: '# Roadmap\n\nShared plan.\n' }),
    });
    expect(created.ok).toBeTruthy();

    await signIn(page, bobToken);

    const grant = await fetch(`${API_URL}/api/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(aliceToken) },
      body: JSON.stringify({ grantee_email: bob, path: notePath, permission: 'comment' }),
    });
    expect(grant.ok).toBeTruthy();

    await expect(badge(page)).toHaveText('1', { timeout: 10_000 });
    await page.locator('.kp-inbox-btn').click();
    const item = page.locator('.kp-inbox-item.is-unread');
    await expect(item).toContainText('shared');
    await expect(item).toContainText('with you');
    await item.click();
    await expect(page.locator('.editor-content .tiptap')).toContainText('Shared plan.', { timeout: 15_000 });
    await expect(badge(page)).toHaveCount(0);
  });

  test('the unsubscribe link turns emails off and Settings can turn them back on', async ({ page }) => {
    const { bob, bobToken } = users('unsub');
    await register(bobToken);

    // Same shape the server puts in notification emails (signed with the test JWT secret).
    const token = jwt.sign({ sub: bob, purpose: 'notification-unsubscribe' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${API_URL}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('You are unsubscribed');

    // A wrong-purpose token is refused.
    const bad = jwt.sign({ sub: bob, purpose: 'something-else' }, JWT_SECRET);
    const badRes = await fetch(`${API_URL}/api/notifications/unsubscribe?token=${encodeURIComponent(bad)}`);
    expect(badRes.status).toBe(400);

    await signIn(page, bobToken);
    await page.locator('.kp-overflow > button').click();
    await page.locator('.kp-overflow-item', { hasText: 'Settings' }).click();
    await expect(page.locator('input[name="email-notifications"][value="none"]')).toBeChecked({ timeout: 10_000 });

    await page.locator('input[name="email-notifications"][value="all"]').check();
    await expect.poll(async () => {
      const r = await fetch(`${API_URL}/api/notifications/preferences`, { headers: bearer(bobToken) });
      return (await r.json()).email;
    }).toBe('all');
  });
});
