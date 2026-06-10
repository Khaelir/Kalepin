import { test, expect, createNote } from '../fixtures';

const TABLE_MD = `# Table Test

| Col A | Col B |
| ----- | ----- |
| r1c1  | r1c2  |
| r2c1  | r2c2  |
`;

test.describe('Table collaboration', () => {
  test('remote cell edit preserves table structure', async ({ browser }) => {
    const noteName = `table-integrity-${Date.now()}.md`;
    createNote(noteName, TABLE_MD);

    const { pageA, pageB, cleanup } = await setupPair(browser, noteName);

    // Ensure table content is fully loaded on both pages before interacting
    await expect(pageA.locator('.editor-content .tiptap table td').first()).toContainText('r1c1');
    await expect(pageB.locator('.editor-content .tiptap table td').first()).toContainText('r1c1');

    // User A clicks into the first table cell and types
    const cellA = pageA.locator('.editor-content .tiptap table td').first();
    await cellA.click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type(' edited');

    // Wait for sync to user B
    await expect(async () => {
      const text = await pageB.locator('.editor-content .tiptap table td').first().innerText();
      expect(text).toContain('edited');
    }).toPass({ timeout: 10_000 });

    // Verify table structure on user B's side
    const tables = pageB.locator('.editor-content .tiptap table');
    await expect(tables).toHaveCount(1);

    const rows = pageB.locator('.editor-content .tiptap table tr');
    // Header row + 2 data rows = 3
    await expect(rows).toHaveCount(3);

    const cells = pageB.locator('.editor-content .tiptap table td');
    // 2 data rows * 2 cols = 4 td cells
    await expect(cells).toHaveCount(4);

    // No nested tables
    const nestedTables = pageB.locator('.editor-content .tiptap table table');
    await expect(nestedTables).toHaveCount(0);

    await cleanup();
  });

  test('undo does not revert remote table edit', async ({ browser }) => {
    const noteName = `table-undo-${Date.now()}.md`;
    createNote(noteName, TABLE_MD);

    const { pageA, pageB, cleanup } = await setupPair(browser, noteName);

    // Ensure table content is fully loaded on both pages
    await expect(pageA.locator('.editor-content .tiptap table td').first()).toContainText('r1c1');
    await expect(pageB.locator('.editor-content .tiptap table td').first()).toContainText('r1c1');

    // User A edits a cell
    const cellA = pageA.locator('.editor-content .tiptap table td').first();
    await cellA.click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type(' remote');

    // Wait for sync to user B
    await expect(async () => {
      const text = await pageB.locator('.editor-content .tiptap table td').first().innerText();
      expect(text).toContain('remote');
    }).toPass({ timeout: 10_000 });

    // User B presses Ctrl+Z (undo)
    await pageB.locator('.editor-content .tiptap').click();
    await pageB.keyboard.press('Meta+z');

    // Short wait to let undo apply
    await pageB.waitForTimeout(1000);

    // Remote edit should still be visible
    const cellB = pageB.locator('.editor-content .tiptap table td').first();
    await expect(cellB).toContainText('remote');

    await cleanup();
  });

  test('remote paragraph edit applies without corruption', async ({ browser }) => {
    const noteName = `para-sync-${Date.now()}.md`;
    createNote(noteName, '# Paragraph Test\n\nOriginal text here.\n');

    const { pageA, pageB, cleanup } = await setupPair(browser, noteName);

    // Ensure content is fully loaded on both pages
    await expect(pageA.locator('.editor-content .tiptap p').first()).toContainText('Original text');
    await expect(pageB.locator('.editor-content .tiptap p').first()).toContainText('Original text');

    // User A clicks on the paragraph and edits it
    const paraA = pageA.locator('.editor-content .tiptap p').first();
    await paraA.click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type(' Added by Alice.');

    // Wait for sync to user B
    await expect(async () => {
      const text = await pageB.locator('.editor-content .tiptap p').first().innerText();
      expect(text).toContain('Added by Alice');
    }).toPass({ timeout: 10_000 });

    // Verify no content corruption — original text still present
    const paraB = pageB.locator('.editor-content .tiptap p').first();
    await expect(paraB).toContainText('Original text here.');
    await expect(paraB).toContainText('Added by Alice.');

    await cleanup();
  });
});

// Helper to set up a collaboration pair for these tests
import jwt from 'jsonwebtoken';
import { FRONTEND_PORT, VAULT_PATH } from '../playwright.config';
import type { Browser, Page } from '@playwright/test';

let pairCounter = 0;

async function setupPair(browser: Browser, notePath: string) {
  const baseURL = `http://localhost:${FRONTEND_PORT}`;

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const tokenA = jwt.sign(
    { sub: 100 + ++pairCounter, email: 'alice@example.com' },
    'test-secret',
    { expiresIn: '1h' },
  );
  const tokenB = jwt.sign(
    { sub: 200 + pairCounter, email: 'bob@example.com' },
    'test-secret',
    { expiresIn: '1h' },
  );

  for (const [page, token] of [[pageA, tokenA], [pageB, tokenB]] as [Page, string][]) {
    await page.goto(baseURL);
    await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
    await page.goto(`${baseURL}/doc/${encodeURIComponent(notePath)}`);
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
  }

  const cleanup = async () => {
    await contextA.close();
    await contextB.close();
  };

  return { pageA, pageB, cleanup };
}
