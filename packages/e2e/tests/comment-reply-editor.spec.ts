import { test, expect, createNote } from '../fixtures';
import jwt from 'jsonwebtoken';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';
import type { Page } from '@playwright/test';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;

let subCounter = 700;

function makeToken(email: string): string {
  return jwt.sign({ sub: ++subCounter, email }, 'test-secret', { expiresIn: '1h' });
}

async function openNote(page: Page, token: string, notePath: string) {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(`${BASE_URL}/doc/${encodeURIComponent(notePath)}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

async function addCommentViaAPI(token: string, notePath: string, quotedText: string, text: string) {
  const res = await fetch(`${API_URL}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path: notePath, blockId: crypto.randomUUID(), text, quotedText }),
  });
  if (!res.ok) throw new Error(`Failed to add comment: ${res.status}`);
  return res.json();
}

/** Register a user by hitting an authenticated endpoint (user is auto-provisioned on first JWT use). */
async function registerUser(token: string) {
  await fetch(`${API_URL}/api/files/tree`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Open the reply editor for the first visible comment thread. */
async function openReplyEditor(page: Page) {
  await expect(page.locator('.comments-panel')).toBeVisible({ timeout: 5_000 });
  await page.locator('.reply-btn').first().click();
  await expect(page.locator('.comment-reply-editor')).toBeVisible({ timeout: 5_000 });
}

const NOTE_MD = `# Reply Editor Test

This is a paragraph to comment on.

Another paragraph for testing.
`;

// ---------------------------------------------------------------------------
// Comment reply editor: mention pills while composing
// ---------------------------------------------------------------------------
test.describe('Comment reply editor', () => {
  test('5.1 typing @ in reply editor triggers autocomplete dropdown', async ({ page }) => {
    const noteName = `reply-autocomplete-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('author@example.com');
    // Register a second user so autocomplete has results
    const bobToken = makeToken('bob@example.com');
    await registerUser(bobToken);

    await openNote(page, token, noteName);
    await addCommentViaAPI(token, noteName, 'paragraph to comment on', 'Need feedback');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await openReplyEditor(page);

    // Type @ to trigger mention autocomplete
    await page.locator('.comment-reply-editor').pressSequentially('@');

    // The mention autocomplete dropdown should appear with both registered
    // users matching. Use ≥2 (not ==2) since the user table is shared with
    // earlier specs in the same run — extra registered users would otherwise
    // make this assertion order-dependent.
    await expect(page.locator('.mention-autocomplete')).toBeVisible({ timeout: 5_000 });
    const itemCount = await page.locator('.mention-menu-item').count();
    expect(itemCount).toBeGreaterThanOrEqual(2);
    // Both planted users must appear by name.
    await expect(
      page.locator('.mention-menu-item', { hasText: 'author@example.com' }),
    ).toBeVisible();
    await expect(
      page.locator('.mention-menu-item', { hasText: 'bob@example.com' }),
    ).toBeVisible();
  });

  test('5.2 selecting a user inserts a mention pill with correct color', async ({ page }) => {
    const noteName = `reply-pill-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('author@example.com');
    const bobToken = makeToken('bob@example.com');
    await registerUser(bobToken);

    await openNote(page, token, noteName);
    await addCommentViaAPI(token, noteName, 'paragraph to comment on', 'Need review');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await openReplyEditor(page);

    // Type @bob and select from autocomplete
    await page.locator('.comment-reply-editor').pressSequentially('@bob');
    await expect(page.locator('.mention-autocomplete')).toBeVisible({ timeout: 5_000 });

    // Click the first matching item
    await page.locator('.mention-menu-item').first().click({ force: true });

    // A mention pill should now appear in the reply editor
    const pill = page.locator('.comment-reply-editor .mention-badge-text');
    await expect(pill).toBeVisible({ timeout: 5_000 });
    await expect(pill).toContainText('@bob');

    // Should have an inline color style
    const color = await pill.evaluate((el) => el.style.color);
    expect(color).toBeTruthy();
  });

  test('5.3 submitting a reply with mentions serializes correctly and renders pills', async ({ page }) => {
    const noteName = `reply-submit-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('author@example.com');
    const bobToken = makeToken('bob@example.com');
    await registerUser(bobToken);

    await openNote(page, token, noteName);
    await addCommentViaAPI(token, noteName, 'paragraph to comment on', 'Initial comment');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await openReplyEditor(page);

    // Type "hey " then mention bob then " thoughts?"
    const editor = page.locator('.comment-reply-editor');
    await editor.pressSequentially('hey ');
    await editor.pressSequentially('@bob');
    await expect(page.locator('.mention-autocomplete')).toBeVisible({ timeout: 5_000 });
    await page.locator('.mention-menu-item').first().click({ force: true });
    await expect(page.locator('.comment-reply-editor .mention-badge-text')).toBeVisible({ timeout: 5_000 });
    await editor.pressSequentially('thoughts?');

    // Click Reply
    await page.locator('.reply-actions button').first().click();

    // The reply form should close
    await expect(page.locator('.comment-reply-editor')).not.toBeVisible({ timeout: 5_000 });

    // The submitted reply should appear in the thread with a mention pill
    const replyMention = page.locator('.comment-reply .comment-text .mention');
    await expect(replyMention).toBeVisible({ timeout: 5_000 });
    await expect(replyMention).toContainText('@bob');
  });

  test('5.4 backspace deletes mention pill atomically', async ({ page }) => {
    const noteName = `reply-backspace-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('author@example.com');
    const bobToken = makeToken('bob@example.com');
    await registerUser(bobToken);

    await openNote(page, token, noteName);
    await addCommentViaAPI(token, noteName, 'paragraph to comment on', 'Testing backspace');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await openReplyEditor(page);

    // Insert a mention
    await page.locator('.comment-reply-editor').pressSequentially('@bob');
    await expect(page.locator('.mention-autocomplete')).toBeVisible({ timeout: 5_000 });
    await page.locator('.mention-menu-item').first().click({ force: true });

    const pill = page.locator('.comment-reply-editor .mention-badge');
    await expect(pill).toBeVisible({ timeout: 5_000 });

    // Cursor should be after the pill + space. Press Backspace twice:
    // first deletes the trailing space, second deletes the atomic mention node
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    // The mention pill should be gone
    await expect(pill).not.toBeVisible({ timeout: 3_000 });
  });

  test('5.5 pasting rich text keeps only plain text', async ({ context, page }) => {
    const noteName = `reply-paste-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('author@example.com');

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await openNote(page, token, noteName);
    await addCommentViaAPI(token, noteName, 'paragraph to comment on', 'Paste test');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await openReplyEditor(page);

    // Paste rich HTML content into the editor via clipboard API
    await page.evaluate(async () => {
      const html = '<b>bold</b> and <em>italic</em> and <a href="https://example.com">link</a>';
      const blob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob(['bold and italic and link'], { type: 'text/plain' });
      const item = new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob });
      await navigator.clipboard.write([item]);
    });
    await page.locator('.comment-reply-editor').focus();
    await page.keyboard.press('Meta+v');

    // The editor should contain the text but no bold/italic/link elements
    const editor = page.locator('.comment-reply-editor');
    await expect(editor).toContainText('bold and italic and link', { timeout: 5_000 });

    // No formatting elements should exist
    await expect(editor.locator('strong, b, em, i, a')).toHaveCount(0);
  });

  test('5.6 cancel and reopen gives a fresh editor', async ({ page }) => {
    const noteName = `reply-cancel-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('author@example.com');

    await openNote(page, token, noteName);
    await addCommentViaAPI(token, noteName, 'paragraph to comment on', 'Cancel test');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await openReplyEditor(page);

    // Type some text
    await page.locator('.comment-reply-editor').pressSequentially('some draft text');
    await expect(page.locator('.comment-reply-editor')).toContainText('some draft text');

    // Click Cancel
    await page.locator('.reply-actions button').last().click();

    // Reply editor should be gone
    await expect(page.locator('.comment-reply-editor')).not.toBeVisible({ timeout: 3_000 });

    // Reopen the reply editor
    await openReplyEditor(page);

    // Editor should be empty (no stale content)
    const text = await page.locator('.comment-reply-editor').innerText();
    expect(text.trim()).toBe('');
  });

  test('5.7 editor receives focus when reply is opened', async ({ page }) => {
    const noteName = `reply-focus-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('author@example.com');

    await openNote(page, token, noteName);
    await addCommentViaAPI(token, noteName, 'paragraph to comment on', 'Focus test');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await openReplyEditor(page);

    // The contenteditable element inside the reply editor should be focused
    await expect(async () => {
      const isFocused = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.closest('.comment-reply-editor') !== null;
      });
      expect(isFocused).toBe(true);
    }).toPass({ timeout: 5_000 });
  });
});
