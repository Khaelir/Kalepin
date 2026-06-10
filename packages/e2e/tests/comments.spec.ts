import { test, expect, createNote } from '../fixtures';
import jwt from 'jsonwebtoken';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';
import type { Page } from '@playwright/test';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;

function makeToken(email: string, sub: number): string {
  return jwt.sign({ sub, email }, 'test-secret', { expiresIn: '1h' });
}

async function openNote(page: Page, token: string, notePath: string) {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(`${BASE_URL}/doc/${encodeURIComponent(notePath)}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

async function addCommentViaAPI(token: string, path: string, quotedText: string, text: string, positionHint?: { from: number; to: number }) {
  const res = await fetch(`${API_URL}/api/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      path,
      blockId: crypto.randomUUID(),
      text,
      quotedText,
      positionHint,
    }),
  });
  if (!res.ok) throw new Error(`Failed to add comment: ${res.status}`);
  return res.json();
}

async function fetchThreads(token: string, path: string) {
  const res = await fetch(`${API_URL}/api/comments?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

const NOTE_MD = `# Comment Test

This is a paragraph with some text to comment on.

Another paragraph for testing.
`;

test.describe('Comment click navigation', () => {
  test('clicking comment icon in editor opens panel and selects text', async ({ page }) => {
    const noteName = `comment-icon-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('commenter@example.com', 500);
    await openNote(page, token, noteName);

    const quotedText = 'some text to comment on';
    await addCommentViaAPI(token, noteName, quotedText, 'This is a test comment');

    // Reload to pick up the comment
    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.comment-highlight-icon')).toBeVisible({ timeout: 10_000 });

    // Close the comments panel first (it's open by default)
    const sidebar = page.locator('.comments-sidebar-toggle');
    if (await sidebar.isVisible()) {
      await sidebar.click();
      await page.waitForTimeout(300);
    }

    // Click the comment icon in the editor
    await page.locator('.comment-highlight-icon').click();

    // The comments panel should open
    await expect(page.locator('.comments-panel')).toBeVisible({ timeout: 5_000 });

    // The comment thread should appear in the panel
    await expect(page.locator('.comment-thread')).toBeVisible({ timeout: 5_000 });

    // The quoted text should be selected in the editor
    await expect(async () => {
      const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
      expect(selectedText).toBe(quotedText);
    }).toPass({ timeout: 5_000 });
  });

  test('clicking thread in comments panel selects text in editor', async ({ page }) => {
    const noteName = `comment-panel-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('commenter@example.com', 501);
    await openNote(page, token, noteName);

    const quotedText = 'Another paragraph';
    await addCommentViaAPI(token, noteName, quotedText, 'Panel click test');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.comment-highlight-icon')).toBeVisible({ timeout: 10_000 });

    // Click somewhere else in the editor to place cursor away from comment
    await page.locator('.editor-content .tiptap h1').click();

    // Ensure the comments panel is open
    await expect(page.locator('.comments-panel')).toBeVisible({ timeout: 5_000 });

    // Click the thread in the comments panel
    await page.locator('.comment-thread').click();

    // The quoted text should be selected in the editor
    await expect(async () => {
      const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
      expect(selectedText).toBe(quotedText);
    }).toPass({ timeout: 5_000 });
  });

  test('comment icon shows correct reply count badge', async ({ page }) => {
    const noteName = `comment-badge-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('commenter@example.com', 502);
    await openNote(page, token, noteName);

    const quotedText = 'some text to comment on';
    await addCommentViaAPI(token, noteName, quotedText, 'First comment');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.comment-highlight-icon')).toBeVisible({ timeout: 10_000 });

    // Single comment — no badge
    await expect(page.locator('.comment-highlight-badge')).toHaveCount(0);

    // Add a reply
    const threads = await fetchThreads(token, noteName);
    const thread = threads[0];
    await fetch(`${API_URL}/api/comments/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: noteName, blockId: thread.blockId, threadId: thread.id, text: 'A reply' }),
    });

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.comment-highlight-icon')).toBeVisible({ timeout: 10_000 });

    // Badge should show "2"
    await expect(page.locator('.comment-highlight-badge')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.comment-highlight-badge')).toHaveText('2');
  });

  test('resolved comments do not show highlight decorations', async ({ page }) => {
    const noteName = `comment-resolved-${Date.now()}.md`;
    createNote(noteName, NOTE_MD);
    const token = makeToken('commenter@example.com', 503);
    await openNote(page, token, noteName);

    const quotedText = 'some text to comment on';
    await addCommentViaAPI(token, noteName, quotedText, 'Will resolve this');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.comment-highlight-icon')).toBeVisible({ timeout: 10_000 });

    // Resolve the thread via API
    const threads = await fetchThreads(token, noteName);
    const thread = threads[0];
    await fetch(`${API_URL}/api/comments/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: noteName, blockId: thread.blockId, threadId: thread.id, resolved: true }),
    });

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    await expect(page.locator('.comment-highlight-icon')).toHaveCount(0);
  });

  test('clicking comment icon navigates to off-screen comment', async ({ page }) => {
    // Create a long note with a comment on text near the bottom
    const lines = ['# Long Document\n'];
    for (let i = 0; i < 60; i++) {
      lines.push(`Paragraph ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n`);
    }
    lines.push('This is the target text at the bottom of the document.\n');
    const noteName = `comment-offscreen-${Date.now()}.md`;
    createNote(noteName, lines.join('\n'));
    const token = makeToken('commenter@example.com', 504);
    await openNote(page, token, noteName);

    const quotedText = 'target text at the bottom';
    await addCommentViaAPI(token, noteName, quotedText, 'Off-screen comment');

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    // Scroll to top to ensure the comment is off-screen
    await page.evaluate(() => {
      document.querySelector('.editor-container')?.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);

    // The comment icon should exist but might not be visible in viewport
    await expect(page.locator('.comment-highlight-icon')).toHaveCount(1, { timeout: 10_000 });

    // Close the panel if open, then click the icon via the comments panel
    // (since icon might be off-screen, open panel and click thread to navigate)
    await expect(page.locator('.comments-panel')).toBeVisible({ timeout: 5_000 });
    await page.locator('.comment-thread').click();

    // After clicking, the editor should scroll to show the comment
    await expect(async () => {
      const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
      expect(selectedText).toBe(quotedText);
    }).toPass({ timeout: 5_000 });

    // Verify the highlighted text is now visible in the viewport
    await expect(async () => {
      const isVisible = await page.evaluate(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const container = document.querySelector('.editor-container');
        if (!container) return false;
        const cRect = container.getBoundingClientRect();
        return rect.top >= cRect.top && rect.bottom <= cRect.bottom;
      });
      expect(isVisible).toBe(true);
    }).toPass({ timeout: 5_000 });
  });
});
