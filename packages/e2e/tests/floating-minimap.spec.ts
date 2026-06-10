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

function buildLongNote(targetText: string): string {
  const lines = ['# Long Document\n'];
  for (let i = 0; i < 60; i++) {
    lines.push(`Paragraph ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n`);
  }
  lines.push(`${targetText}\n`);
  return lines.join('\n');
}

test.describe('Floating mini-map', () => {
  test('renders heading ticks and a comment marker for each comment', async ({ page }) => {
    const noteName = `minimap-markers-${Date.now()}.md`;
    const targetText = 'This is the target text for marker rendering.';
    createNote(noteName, buildLongNote(targetText));
    const token = makeToken('user@example.com', 600);
    await openNote(page, token, noteName);

    await addCommentViaAPI(token, noteName, targetText, 'A comment on long doc');
    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('.kp-minimap')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.kp-minimap-tick')).toHaveCount(1);
    await expect(page.locator('.kp-scrollstrip-marker')).toHaveCount(1);
  });

  test('resolved comments stay rendered with the .is-resolved modifier', async ({ page }) => {
    const noteName = `minimap-resolved-${Date.now()}.md`;
    const targetText = 'This is the target text for resolve test.';
    createNote(noteName, buildLongNote(targetText));
    const token = makeToken('user@example.com', 601);
    await openNote(page, token, noteName);

    await addCommentViaAPI(token, noteName, targetText, 'Will be resolved');
    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    const marker = page.locator('.kp-scrollstrip-marker');
    await expect(marker).toHaveCount(1, { timeout: 10_000 });
    await expect(marker).not.toHaveClass(/is-resolved/);

    const threads = await fetchThreads(token, noteName);
    const thread = threads[0];
    await fetch(`${API_URL}/api/comments/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: noteName, blockId: thread.blockId, threadId: thread.id, resolved: true }),
    });

    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    // Phase 8 changed the contract: resolved markers stay visible but faded.
    await expect(page.locator('.kp-scrollstrip-marker.is-resolved')).toHaveCount(1, { timeout: 10_000 });
  });

  test('clicking a comment marker scrolls to and selects the quoted text', async ({ page }) => {
    const noteName = `minimap-click-${Date.now()}.md`;
    const targetText = 'This is the target text for click navigation.';
    createNote(noteName, buildLongNote(targetText));
    const token = makeToken('user@example.com', 603);
    await openNote(page, token, noteName);

    await addCommentViaAPI(token, noteName, targetText, 'Click me to navigate');
    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await page.evaluate(() => {
      document.querySelector('.editor-container')?.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);

    const marker = page.locator('.kp-scrollstrip-marker');
    await expect(marker).toBeVisible({ timeout: 10_000 });
    await marker.click();

    await expect(async () => {
      const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
      expect(selectedText).toBe(targetText);
    }).toPass({ timeout: 5_000 });

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

  test('mini-map stays in the editor viewport while the doc scrolls', async ({ page }) => {
    const noteName = `minimap-pinned-${Date.now()}.md`;
    const targetText = 'This is the target text for scroll stability.';
    createNote(noteName, buildLongNote(targetText));
    const token = makeToken('user@example.com', 604);
    await openNote(page, token, noteName);

    await addCommentViaAPI(token, noteName, targetText, 'Stability test comment');
    await page.reload();
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.kp-minimap')).toBeVisible({ timeout: 10_000 });

    // The right rail auto-collapses when there are zero open comments and
    // expands once the fetched comment lands; that flip mutates the editor
    // area's right edge, which in turn moves the minimap. Wait for the rail
    // to settle into its final (expanded) state before sampling.
    await expect(page.locator('.kp-rail')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.workspace.rail-collapsed')).toHaveCount(0, { timeout: 10_000 });

    const readRect = () =>
      page.locator('.kp-minimap').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, right: r.right };
      });

    // The minimap is positioned against the editor area's getBoundingClientRect.
    // After page reload, comments fetch + render are async; the layout settles
    // a couple of frames late, so seed the baseline only once two consecutive
    // reads agree. Without this the initial sample can land mid-flight and
    // diverge from later samples — that's the flake the original test hit.
    let initial = await readRect();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(60);
      const next = await readRect();
      if (Math.abs(next.right - initial.right) < 0.5 && Math.abs(next.top - initial.top) < 0.5) {
        initial = next;
        break;
      }
      initial = next;
    }

    await page.evaluate(() => {
      const c = document.querySelector('.editor-container')!;
      c.scrollTo(0, c.scrollHeight / 2);
    });
    await page.waitForTimeout(200);
    const mid = await readRect();
    expect(Math.abs(mid.top - initial.top)).toBeLessThan(2);
    expect(Math.abs(mid.right - initial.right)).toBeLessThan(2);

    await page.evaluate(() => {
      const c = document.querySelector('.editor-container')!;
      c.scrollTo(0, c.scrollHeight);
    });
    await page.waitForTimeout(200);
    const bottom = await readRect();
    expect(Math.abs(bottom.top - initial.top)).toBeLessThan(2);
    expect(Math.abs(bottom.right - initial.right)).toBeLessThan(2);
  });
});
