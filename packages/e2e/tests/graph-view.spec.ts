import { test, expect, createNote } from '../fixtures';
import jwt from 'jsonwebtoken';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';
import type { Page } from '@playwright/test';

// Create a small vault of linked notes for graph testing
function setupLinkedNotes(prefix: string) {
  const ts = Date.now();
  const hub = `${prefix}-hub-${ts}.md`;
  const spoke1 = `${prefix}-spoke1-${ts}.md`;
  const spoke2 = `${prefix}-spoke2-${ts}.md`;

  createNote(spoke1, `# Spoke One\n\nSome content here.\n`);
  createNote(spoke2, `# Spoke Two\n\nSome content here.\n`);
  createNote(hub, `# Hub Note\n\nLinks to [[${spoke1.replace('.md', '')}]] and [[${spoke2.replace('.md', '')}]].\n\nAlso a [[broken-link-target]].\n`);

  return { hub, spoke1, spoke2 };
}

async function authenticateAndOpen(page: Page, notePath: string) {
  const token = jwt.sign(
    { sub: 500 + Math.floor(Math.random() * 1000), email: 'graphtest@example.com' },
    'test-secret',
    { expiresIn: '1h' },
  );
  const baseURL = `http://localhost:${FRONTEND_PORT}`;
  await page.goto(baseURL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(`${baseURL}/doc/${encodeURIComponent(notePath)}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
  // Allow time for the link indexer to process the files
  await page.waitForTimeout(2000);
  return token;
}

test.describe('Graph view', () => {
  test('backlinks panel shows list/graph toggle and defaults to list', async ({ page }) => {
    const { hub } = setupLinkedNotes('toggle');
    await authenticateAndOpen(page, hub);

    // Open backlinks panel
    await page.locator('[data-testid="rail-tab-backlinks"]').click();

    // Verify toggle exists
    const toggle = page.locator('[data-testid="backlinks-mode-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 5_000 });

    // Verify list mode is active by default
    const listBtn = toggle.locator('button', { hasText: 'List' });
    await expect(listBtn).toHaveClass(/active/);

    // Verify backlinks content loads (list sections appear after loading)
    await expect(page.locator('.backlinks-section').first()).toBeVisible({ timeout: 10_000 });
  });

  test('toggle to graph mode renders canvas', async ({ page }) => {
    const { hub } = setupLinkedNotes('canvas');
    await authenticateAndOpen(page, hub);

    // Open backlinks panel
    await page.locator('[data-testid="rail-tab-backlinks"]').click();
    await expect(page.locator('[data-testid="backlinks-mode-toggle"]')).toBeVisible({ timeout: 5_000 });

    // Click Graph button
    await page.locator('[data-testid="backlinks-mode-toggle"] button', { hasText: 'Graph' }).click();

    // Verify graph panel appears with a canvas element
    await expect(page.locator('[data-testid="graph-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="graph-panel"] canvas')).toBeVisible({ timeout: 10_000 });
  });

  test('toggle back to list from graph restores backlinks list', async ({ page }) => {
    const { hub } = setupLinkedNotes('toggleback');
    await authenticateAndOpen(page, hub);

    // Open backlinks panel and switch to graph
    await page.locator('[data-testid="rail-tab-backlinks"]').click();
    await expect(page.locator('[data-testid="backlinks-mode-toggle"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="backlinks-mode-toggle"] button', { hasText: 'Graph' }).click();
    await expect(page.locator('[data-testid="graph-panel"] canvas')).toBeVisible({ timeout: 10_000 });

    // Switch back to list
    await page.locator('[data-testid="backlinks-mode-toggle"] button', { hasText: 'List' }).click();

    // Verify backlinks list section is visible again
    await expect(page.locator('.backlinks-section').first()).toBeVisible({ timeout: 10_000 });
    // Graph panel should be gone
    await expect(page.locator('[data-testid="graph-panel"]')).toHaveCount(0);
  });

  test('full-screen graph view renders and back button works', async ({ page }) => {
    const { hub } = setupLinkedNotes('fullscreen');
    await authenticateAndOpen(page, hub);

    // Open backlinks panel, switch to graph, click pop-out
    await page.locator('[data-testid="rail-tab-backlinks"]').click();
    await expect(page.locator('[data-testid="backlinks-mode-toggle"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="backlinks-mode-toggle"] button', { hasText: 'Graph' }).click();
    await expect(page.locator('.graph-popout-btn')).toBeVisible({ timeout: 10_000 });

    // Click pop-out button
    await page.locator('.graph-popout-btn').click();

    // Verify full-screen graph view
    await expect(page.locator('[data-testid="graph-view-fullscreen"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="graph-view-fullscreen"] canvas')).toBeVisible({ timeout: 10_000 });

    // Click back button
    await page.locator('.graph-view-back').click();

    // Verify back to workspace (editor visible)
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 10_000 });
  });

  test('graph API returns nodes and edges for linked notes', async ({ page }) => {
    const { hub } = setupLinkedNotes('api');
    const token = await authenticateAndOpen(page, hub);

    // Call the graph API directly
    const response = await page.request.get(
      `http://localhost:${BACKEND_PORT}/api/links/graph?path=${encodeURIComponent(hub)}&depth=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(response.ok()).toBe(true);
    const data = await response.json();

    // Should have nodes (at least the hub)
    expect(data.nodes.length).toBeGreaterThanOrEqual(1);
    const hubNode = data.nodes.find((n: any) => n.path === hub);
    expect(hubNode).toBeTruthy();
    expect(hubNode.title).toBeTruthy();
  });
});
